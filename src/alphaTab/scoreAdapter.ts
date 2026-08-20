/**
 * scoreAdapter — TabScore → alphaTab Score 映射（纯函数，无 DOM / audio）
 *
 * 把应用内存模型（TabScore）转成 alphaTab 的 model.Score，
 * 供 SoundFont 播放（alphaTabPlayer）以及将来可能的渲染 / 导出复用。
 * 本文件是独立适配层，不触碰任何功能块。
 */

import * as alphaTab from '@coderline/alphatab';
import type { Note, NoteDuration, TabScore } from '../types/index.ts';
import { forEachSlot } from '../utils/measureUtils.ts';

/** 扫弦每弦间隔（毫秒），与 synthesis/scheduling.ts 保持一致 */
const STRUM_INTERVAL_MS = 12;
/** 琶音每弦间隔（毫秒），与 synthesis/scheduling.ts 保持一致 */
const ARPEGGIO_INTERVAL_MS = 40;

/** 音名基音 → 半音（C=0 … B=11） */
const BASE_SEMITONE: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** 音名（如 'E4'、'Eb4'、'D#4'）→ MIDI 音号；解析失败返回 0 */
export function noteNameToMidi(noteName: string): number {
    const m = noteName.trim().match(/^([A-Ga-g])([#b]?)(\d{1,2})$/);
    if (!m) return 0;
    const letter = m[1].toUpperCase();
    let semi = BASE_SEMITONE[letter];
    if (m[2] === '#') semi += 1;
    else if (m[2] === 'b') semi -= 1;
    const octave = parseInt(m[3], 10);
    return (octave + 1) * 12 + semi;
}

/** 应用时值（相对值）→ alphaTab Duration 枚举值 */
export function appDurationToAlpha(d: NoteDuration): alphaTab.model.Duration {
    switch (d) {
        case 1: return alphaTab.model.Duration.Whole;
        case 0.5: return alphaTab.model.Duration.Half;
        case 0.25: return alphaTab.model.Duration.Quarter;
        case 0.125: return alphaTab.model.Duration.Eighth;
        case 0.0625: return alphaTab.model.Duration.Sixteenth;
        case 0.03125: return alphaTab.model.Duration.ThirtySecond;
        default: return alphaTab.model.Duration.Quarter;
    }
}

/**
 * 应用弦号 → alphaTab 弦号。
 * 应用 1=高音E(最顶线)..6=低音E；alphaTab 1=最底弦。故取 7 - n。
 */
export function appStringToAlphaString(appString: number): number {
    return 7 - appString;
}

/** 扁平化后的音符条目，供技法/延音的跨槽 lookbehind 使用 */
interface FlatEntry {
    appNote: Note;
    alphaNote: alphaTab.model.Note;
    alphaString: number;
}

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

    // 先加入所有 MasterBar（Staff.addBar 按 bars.length-1 关联同序 masterBar）
    for (const m of score.measures) {
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

    for (const measure of score.measures) {
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

    applyTechniques(at, flat);

    s.finish(new at.Settings());
    return s;
}

/** 技法/延音后处理：需要在播放顺序里跨槽回看同弦前一个音符 */
function applyTechniques(
    at: typeof alphaTab,
    flat: FlatEntry[],
): void {
    for (let i = 0; i < flat.length; i++) {
        const { appNote, alphaNote, alphaString } = flat[i];
        if (appNote.isRest) continue;

        // 延音目标：tieToNext 且非技法（技法音符的 tie 只表示弧线，不合并播放）
        if (appNote.tieToNext && !appNote.technique) {
            alphaNote.isTieDestination = true;
        }

        switch (appNote.technique) {
            case 'hammerOn':
            case 'pullOff': {
                const prev = prevSameString(flat, i, alphaString);
                if (prev) prev.alphaNote.isHammerPullOrigin = true;
                break;
            }
            case 'slide': {
                const prev = prevSameString(flat, i, alphaString);
                if (prev) prev.alphaNote.slideOutType = at.model.SlideOutType.Shift;
                break;
            }
            case 'bend': {
                // app bendAmount 单位是半音；alphaTab BendPoint.value 单位是四分之一音（半音×4）
                const semitones = appNote.bendAmount ?? 1;
                const value = Math.round(semitones * 4);
                if (appNote.bendRelease) {
                    alphaNote.bendType = at.model.BendType.BendRelease;
                    alphaNote.bendPoints = [
                        new at.model.BendPoint(0, 0),
                        new at.model.BendPoint(30, value),
                        new at.model.BendPoint(60, 0),
                    ];
                } else {
                    alphaNote.bendType = at.model.BendType.Bend;
                    alphaNote.bendPoints = [
                        new at.model.BendPoint(0, 0),
                        new at.model.BendPoint(60, value),
                    ];
                }
                break;
            }
            case 'vibrato': {
                alphaNote.vibrato = at.model.VibratoType.Slight;
                break;
            }
            default:
                break;
        }
    }
}

/** 在 flat 列表里向前找同弦的最近一个非休止音符 */
function prevSameString(
    flat: FlatEntry[],
    upTo: number,
    alphaString: number,
): FlatEntry | null {
    for (let j = upTo - 1; j >= 0; j--) {
        const e = flat[j];
        if (!e.appNote.isRest && e.alphaString === alphaString) return e;
    }
    return null;
}
