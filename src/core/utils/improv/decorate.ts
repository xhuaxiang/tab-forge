/**
 * decorate — 把带把位的骨架转成 Note[]，并施加 v1 允许的演奏层。
 *
 * v1 只生成 dynamics / bend / vibrato / palmMute 四类标记；
 * H/P/S、滑弦、泛音、延音、断音、和弦组全部留给后续版本，
 * 以免越出 validate.ts 的白名单。
 */

import type { Note } from '../../types/index.ts';
import type {
    PlayabilityRules,
    PositionedSlot,
    StyleProfile,
} from '../../types/improv.ts';
import { BEND_AMOUNT_LABELS } from '../../config.ts';
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

/**
 * 给一个已定位的音加技法。
 *
 * 技法互斥由 Note 模型决定：technique 只有一档，palmMute 也不能和它叠加。
 * 顺序固定为 bend → vibrato → palmMute，前面的不满足条件才轮到后面。
 */
function applyArticulation(
    note: Note,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
): void {
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
    return positioned.map(item => {
        const skeleton = item.skeleton;
        if (skeleton.isRest) {
            return { isRest: true, duration: skeleton.duration };
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

        const dynamics = dynamicsFor(skeleton.role, style, rng);
        if (dynamics !== undefined) note.dynamics = dynamics;

        applyArticulation(note, style, playability, rng);
        return note;
    });
}
