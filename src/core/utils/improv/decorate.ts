/**
 * decorate — 把带把位的骨架转成 Note[]，并施加本地生成支持的演奏层。
 *
 * 生成 dynamics / bend / vibrato / palmMute / hammerOn / pullOff / slide；
 * 泛音、延音、断音、和弦组仍留给后续版本，以免越出 validate.ts 的白名单。
 */

import type { Note } from '../../types/index.ts';
import type {
    PlayabilityRules,
    PositionedSlot,
    StyleProfile,
} from '../../types/improv.ts';
import { BEND_AMOUNT_LABELS } from '../../config.ts';
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

/**
 * 给一个已定位的音加技法。
 *
 * 技法互斥由 Note 模型决定：technique 只有一档，palmMute 也不能和它叠加。
 * 顺序固定为连接技法 → bend → vibrato → palmMute，前面的不满足条件才轮到后面。
 */
function applyArticulation(
    note: Note,
    previous: Note | undefined,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
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
    if (string >= playability.palmMuteStrings[0]
        && string <= playability.palmMuteStrings[1]
        && note.duration >= playability.minPalmMuteDuration
        && rng() < style.palmMuteProbability) {
        note.palmMute = true;
    }
}

export function decorateSlots(
    positioned: PositionedSlot[],
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
): Note[] {
    const notes: Note[] = [];
    let previous: Note | undefined;

    for (const item of positioned) {
        const skeleton = item.skeleton;
        if (skeleton.isRest) {
            notes.push({ isRest: true, duration: skeleton.duration });
            // 休止会打断所有弦上的连接；后面的音不能再借用前面的缓冲区。
            previous = undefined;
            continue;
        }

        const position = item.positions[0];
        if (position === undefined) {
            throw new Error('发音 slot 缺少把位');
        }

        const note: Note = {
            string: position.string,
            fret: position.fret,
            duration: skeleton.duration,
        };

        applyArticulation(note, previous, style, playability, rng);

        // 连接目标是复用源音缓冲发声，自己的力度不会进入播放；写上去只会
        // 让谱面与听感不一致，因此不给连接目标记 dynamics。
        if (!isConnectingTechnique(note.technique)) {
            const dynamics = dynamicsFor(skeleton.role, style, rng);
            if (dynamics !== undefined) note.dynamics = dynamics;
        }

        notes.push(note);
        previous = note;
    }

    return notes;
}
