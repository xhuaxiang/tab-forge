/**
 * scoreAdapter — TabScore → alphaTab Score 映射（纯函数，无 DOM / audio）
 *
 * 把应用内存模型（TabScore）转成 alphaTab 的 model.Score，
 * 供 SoundFont 播放（alphaTabPlayer）以及将来可能的渲染 / 导出复用。
 * 本文件是独立适配层，不触碰任何功能块。
 *
 * 只做「按结构 1:1 映射」；技法/延音那类需要跨槽回看的二次修改在
 * techniqueAdapter.ts（本文件在结尾把 flatten 列表交给它）。
 */

import * as alphaTab from '@coderline/alphatab';
import type { TabScore, Measure } from '../../core/types/index.ts';
import { forEachSlot } from '../../core/utils/measureUtils.ts';
import {
    noteNameToMidi,
    appDurationToAlpha,
    appStringToAlphaString,
} from '../../core/utils/scoreMapping.ts';
import { STRUM_INTERVAL_MS, ARPEGGIO_INTERVAL_MS } from '../../core/config.ts';
import { applyTechniques, type FlatEntry } from './techniqueAdapter.ts';

/**
 * 把 TabScore 转换为 alphaTab Score。
 *
 * 结构：Score → 1 Track → 1 Staff（6 弦）→ 每小节一个 MasterBar + Bar + Voice，
 * 每个拍位（chordGroup 分组）一个 Beat，每音符一个 Note。
 */
export function tabScoreToAlphaTabScore(score: TabScore): alphaTab.model.Score {
    const at = alphaTab;
    const s = new at.model.Score();
    s.title = score.title ?? '';
    s.artist = score.artist ?? '';
    if (score.remarks) s.notices = score.remarks;

    // 空谱兜底：至少生成一个小节，避免 alphaTab 渲染/MIDI 对空谱（0 bar / 0 track）报错
    // （渲染器对空谱会走空状态提示而不调用本函数，这里兜底给播放等其他路径）
    const measures: Measure[] = score.measures.length > 0
        ? score.measures
        : [{ index: 0, notes: [], timeSignatureNumerator: 4, timeSignatureDenominator: 4 }];

    // 先加入所有 MasterBar（Staff.addBar 按 bars.length-1 关联同序 masterBar）
    for (const m of measures) {
        const mb = new at.model.MasterBar();
        mb.timeSignatureNumerator = m.timeSignatureNumerator;
        mb.timeSignatureDenominator = m.timeSignatureDenominator;
        s.addMasterBar(mb);
    }
    if (s.masterBars.length > 0) {
        // reference=2 → 缩放系数 1.0，value 即 BPM
        s.masterBars[0].tempoAutomations.push(
            at.model.Automation.buildTempoAutomation(false, 0, score.bpm, 2),
        );
    }

    const track = new at.model.Track();
    track.name = score.title || 'Guitar';
    track.shortName = score.title ? score.title.slice(0, 2) : 'G';
    const playback = new at.model.PlaybackInformation();
    playback.program = 25; // General MIDI: Acoustic Steel Guitar
    playback.primaryChannel = 0;
    playback.secondaryChannel = 1;
    playback.volume = 15;
    playback.balance = 8;
    track.playbackInfo = playback;

    const staff = new at.model.Staff();
    staff.stringTuning = new at.model.Tuning(undefined, [
        noteNameToMidi(score.tuning.string1),
        noteNameToMidi(score.tuning.string2),
        noteNameToMidi(score.tuning.string3),
        noteNameToMidi(score.tuning.string4),
        noteNameToMidi(score.tuning.string5),
        noteNameToMidi(score.tuning.string6),
    ], false);

    const flat: FlatEntry[] = [];

    for (const measure of measures) {
        const bar = new at.model.Bar();
        const voice = new at.model.Voice();
        let beatCount = 0;

        forEachSlot(measure, (slotNotes) => {
            const first = slotNotes[0];
            const beat = new at.model.Beat();
            beat.duration = appDurationToAlpha(first.duration);

            // 休止符：Beat 不加任何 Note（Beat.isRest 由 notes.length 推导）
            if (slotNotes.length === 1 && first.isRest) {
                voice.addBeat(beat);
                beatCount++;
                return;
            }

            // 扫弦/琶音方向 → BrushType（方向映射见实现说明；琶音与直觉相反，需听感验证）
            if (first.strum === 'down') beat.brushType = at.model.BrushType.BrushDown;
            else if (first.strum === 'up') beat.brushType = at.model.BrushType.BrushUp;
            else if (first.arpeggio === 'up') beat.brushType = at.model.BrushType.ArpeggioDown;
            else if (first.arpeggio === 'down') beat.brushType = at.model.BrushType.ArpeggioUp;

            if (beat.brushType !== at.model.BrushType.None) {
                const isArpeggio = beat.brushType === at.model.BrushType.ArpeggioUp
                    || beat.brushType === at.model.BrushType.ArpeggioDown;
                const ms = isArpeggio ? ARPEGGIO_INTERVAL_MS : STRUM_INTERVAL_MS;
                // MIDI 每四分音符 960 tick；(960*bpm/60000) = tick/ms
                beat.brushDuration = Math.max(
                    1,
                    Math.round((slotNotes.length - 1) * ms * (960 * score.bpm / 60000)),
                );
            }

            for (const n of slotNotes) {
                if (n.isRest || n.string === undefined) continue;
                const a = new at.model.Note();
                a.string = appStringToAlphaString(n.string);
                a.fret = n.fret ?? 0;
                beat.addNote(a);
                flat.push({ appNote: n, alphaNote: a, alphaString: a.string });
            }

            voice.addBeat(beat);
            beatCount++;
        });

        // 空小节：放一个全音符休止 Beat，播放时由 alphaTab 补齐整小节
        if (beatCount === 0) {
            const restBeat = new at.model.Beat();
            restBeat.duration = at.model.Duration.Whole;
            voice.addBeat(restBeat);
        }

        bar.addVoice(voice);
        staff.addBar(bar);
    }

    track.addStaff(staff);
    s.addTrack(track);

    // 技法/延音后处理：需要在播放顺序里跨槽回看同弦前一个音符（见 techniqueAdapter.ts）
    applyTechniques(flat);

    s.finish(new at.Settings());
    return s;
}
