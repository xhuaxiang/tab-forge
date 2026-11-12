/**
 * decorate — 把带把位的骨架转成 Note[]，并施加本地生成支持的演奏层。
 *
 * 单音分支产出 dynamics / bend / vibrato / deadNote / harmonic /
 * staccato / letRing / palmMute / hammerOn / pullOff / slide；多声部分支
 * 产出 chordGroup（组首可带 arpeggio / strum），组内不叠加单音奏法。
 */

import type { Note } from '../../types/index.ts';
import type {
    PlayabilityRules,
    PositionedSlot,
    StyleProfile,
} from '../../types/improv.ts';
import { BEND_AMOUNT_LABELS } from '../../config.ts';
import type {
    NoteGroupBase,
    NoteGroupMeta,
} from '../noteGroup.ts';
import { buildNoteGroup } from '../noteGroup.ts';
import type { ConnectingTechnique } from '../technique.ts';
import { isConnectingTechnique } from '../technique.ts';
import { connectIssue } from './connect.ts';
import { pick } from './random.ts';

const BEND_AMOUNTS = Object.keys(BEND_AMOUNT_LABELS).map(Number);

function dynamicsFor(
    role: 'strong' | 'weak' | 'passing',
    style: StyleProfile,
    rng: () => number,
): Note['dynamics'] {
    if (role === 'strong') {
        return rng() < style.accentProbability ? 'accent' : undefined;
    }
    return rng() < style.softProbability ? 'soft' : undefined;
}

function rollConnect(
    note: Note,
    previous: Note | undefined,
    technique: ConnectingTechnique,
    probability: number,
    playability: PlayabilityRules,
    rng: () => number,
): boolean {
    // 可演奏判定与 validate 共用，避免生成器和守门规则各自漂移。
    if (probability <= 0
        || connectIssue(technique, previous, note, playability) !== undefined) {
        return false;
    }
    if (rng() >= probability) return false;
    note.technique = technique;
    return true;
}

function tryConnect(
    note: Note,
    previous: Note | undefined,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
): boolean {
    if (!previous || previous.fret === undefined || note.fret === undefined) {
        return false;
    }

    const diff = note.fret - previous.fret;
    const span = Math.abs(diff);
    if (span >= 1 && span <= playability.maxHammerPullFrets
        && rollConnect(
            note, previous,
            diff > 0 ? 'hammerOn' : 'pullOff',
            style.hammerPullProbability, playability, rng,
        )) {
        return true;
    }
    if (span >= 1 && span <= playability.maxSlideFrets
        && rollConnect(
            note, previous, 'slide',
            style.slideProbability, playability, rng,
        )) {
        return true;
    }
    return false;
}

function applyHarmonic(
    note: Note,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
): boolean {
    const fret = note.fret ?? 0;
    const string = note.string ?? 0;
    const naturalEligible = playability.naturalHarmonicFrets.includes(fret);
    const pinchEligible = string >= playability.pinchHarmonicStrings[0]
        && string <= playability.pinchHarmonicStrings[1]
        && fret > 0;
    const artificialEligible = fret > 0;

    if (style.harmonicProbability <= 0
        || note.duration < playability.minHarmonicDuration
        || (!naturalEligible && !pinchEligible && !artificialEligible)) {
        return false;
    }
    if (rng() >= style.harmonicProbability) return false;

    if (naturalEligible && style.naturalHarmonicShare > 0
        && rng() < style.naturalHarmonicShare) {
        // 自然泛音的节点就是 fret，不写 harmonicFret。
        note.harmonic = 'natural';
        return true;
    }
    if (pinchEligible && style.pinchHarmonicShare > 0
        && rng() < style.pinchHarmonicShare) {
        note.harmonic = 'pinch';
        note.harmonicFret = pick(rng, playability.harmonicFrets);
        return true;
    }
    if (artificialEligible) {
        note.harmonic = 'artificial';
        note.harmonicFret = pick(rng, playability.harmonicFrets);
        return true;
    }
    return false;
}

/**
 * 给一个已定位的单音加技法/奏法。
 *
 * 顺序固定为连接 → bend → vibrato → deadNote → harmonic → staccato →
 * letRing → palmMute，前面的不满足条件才轮到后面。每个新概率分支都在
 * 调用 rng 前判断 probability > 0，概率 0 不会扰动随机流。
 */
function applyArticulation(
    note: Note,
    previous: Note | undefined,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
    isFinalSounding: boolean,
): void {
    // 连接类技法优先：目标音不重新拨弦，直接复用前一个同弦音。
    // 只连紧邻的同弦 slot；中间有休止或换弦时不再复用，避免跨声部误连。
    if (tryConnect(note, previous, style, playability, rng)) return;

    const fret = note.fret ?? 0;

    if (fret > 0
        && note.duration >= playability.minBendDuration
        && rng() < style.bendProbability) {
        note.technique = 'bend';
        note.bendAmount = pick(rng, BEND_AMOUNTS);
        if (note.duration >= playability.minBendReleaseDuration && rng() < 0.5) {
            note.bendRelease = true;
        }
        return;
    }

    if (fret > 0
        && note.duration >= playability.minVibratoDuration
        && rng() < style.vibratoProbability) {
        note.technique = 'vibrato';
        return;
    }

    const string = note.string ?? 0;
    if (style.deadNoteProbability > 0
        && !isFinalSounding
        && string >= playability.deadNoteStrings[0]
        && string <= playability.deadNoteStrings[1]
        && note.duration >= playability.minDeadNoteDuration
        && rng() < style.deadNoteProbability) {
        note.deadNote = true;
        return;
    }

    if (applyHarmonic(note, style, playability, rng)) return;

    if (style.staccatoProbability > 0
        && note.duration >= playability.minStaccatoDuration
        && rng() < style.staccatoProbability) {
        note.staccato = true;
        return;
    }

    if (style.letRingProbability > 0
        && note.duration >= playability.minLetRingDuration
        && rng() < style.letRingProbability) {
        note.letRing = true;
        return;
    }

    if (string >= playability.palmMuteStrings[0]
        && string <= playability.palmMuteStrings[1]
        && note.duration >= playability.minPalmMuteDuration
        && rng() < style.palmMuteProbability) {
        note.palmMute = true;
    }
}

function checkPositionContract(
    item: PositionedSlot,
    playability: PlayabilityRules,
): void {
    const { skeleton, positions } = item;
    if (skeleton.isRest) {
        if (skeleton.midis.length !== 0) {
            throw new Error('休止 slot 不应有音高');
        }
        if (positions.length !== 0) {
            throw new Error('休止 slot 不应有把位');
        }
        return;
    }
    if (positions.length === 0) throw new Error('发音 slot 缺少把位');
    if (positions.length !== skeleton.midis.length) {
        throw new Error('把位数量与音高数量不一致');
    }
    if (positions.length > playability.maxChordVoices) {
        throw new Error('和弦声部过多');
    }
    positions.forEach((position, index) => {
        if (position.midi !== skeleton.midis[index]) {
            throw new Error('把位音高与骨架音高不一致');
        }
    });
}

export function decorateSlots(
    positioned: PositionedSlot[],
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
): Note[] {
    const notes: Note[] = [];
    let previous: Note | undefined;
    let nextChordGroupId = 1;
    let lastSoundingIndex = -1;

    positioned.forEach((item, index) => {
        if (!item.skeleton.isRest) lastSoundingIndex = index;
    });

    positioned.forEach((item, index) => {
        checkPositionContract(item, playability);

        const skeleton = item.skeleton;
        if (skeleton.isRest) {
            notes.push({ isRest: true, duration: skeleton.duration });
            // 休止会打断所有弦上的连接；后面的音不能再借用前面的缓冲区。
            previous = undefined;
            return;
        }

        if (item.positions.length > 1) {
            const dynamics = dynamicsFor(skeleton.role, style, rng);
            const base: NoteGroupBase = { duration: skeleton.duration };
            if (dynamics !== undefined) base.dynamics = dynamics;

            const meta: NoteGroupMeta = {};
            // 扫弦优先于琶音；两者都只写在组首。
            if (style.strumProbability > 0
                && rng() < style.strumProbability) {
                meta.strum = rng() < 0.5 ? 'down' : 'up';
            } else if (style.arpeggioProbability > 0
                && rng() < style.arpeggioProbability) {
                meta.arpeggio = rng() < 0.5 ? 'down' : 'up';
            }

            notes.push(...buildNoteGroup(
                item.positions.map(position => ({
                    string: position.string,
                    fret: position.fret,
                })),
                base,
                meta,
                nextChordGroupId++,
            ));
            // 和弦组不参与单音连接；后面的单音必须重新起音。
            previous = undefined;
            return;
        }

        const position = item.positions[0];
        const note: Note = {
            string: position.string,
            fret: position.fret,
            duration: skeleton.duration,
        };

        applyArticulation(
            note, previous, style, playability, rng, index === lastSoundingIndex,
        );

        // 连接目标是复用源音缓冲发声，自己的力度不会进入播放；写上去只会
        // 让谱面与听感不一致，因此不给连接目标记 dynamics。
        if (!isConnectingTechnique(note.technique)) {
            const dynamics = dynamicsFor(skeleton.role, style, rng);
            if (dynamics !== undefined) note.dynamics = dynamics;
        }

        notes.push(note);
        previous = note;
    });

    return notes;
}
