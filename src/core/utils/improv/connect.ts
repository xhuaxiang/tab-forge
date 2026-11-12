/**
 * connect — 连接类技法（击/勾/滑）的可演奏判定。
 *
 * 生成（decorate）与校验（validate）共用这一份判断，避免两边的
 * 同弦、前音、跨度、方向规则各自漂移。
 */

import type { Note } from '../../types/index.ts';
import type { PlayabilityRules } from '../../types/improv.ts';
import type { ConnectingTechnique } from '../technique.ts';
import { canSourceTechnique } from '../technique.ts';

/**
 * 所有连接技法共有的前提。
 *
 * 生成侧比播放侧更严：播放层对带 bend/vibrato 的前音也会复用缓冲，
 * 但那会把推/揉弦的余音当成新音起点，生成结果不采用这种组合。
 */
function baseIssue(
    previous: Note | undefined,
    note: Note,
    playability: PlayabilityRules,
): string | undefined {
    if (!previous || previous.isRest) {
        return '连接技法缺少紧邻的同弦前音';
    }
    if (previous.string === undefined || note.string === undefined
        || previous.string !== note.string) {
        return '连接技法必须与前音同弦';
    }
    if (previous.fret === undefined || note.fret === undefined) {
        return '连接技法缺少品位';
    }
    if (!canSourceTechnique(previous)) {
        return '连接技法的前音是闷音/制音/断音，不能作为发声源';
    }
    // 泛音要重新拨弦且是另一套音色，不能复用它的缓冲区做连接源。
    if (previous.harmonic !== undefined) {
        return '连接技法的前音是泛音，不能作为发声源';
    }
    if (previous.technique === 'bend' || previous.technique === 'vibrato') {
        return '连接技法的前音带推/揉弦，不能复用';
    }
    if (note.duration < playability.minConnectDuration) {
        return '连接技法时值过短';
    }
    // 目标音不重新拨弦；带独立奏法的目标与连接语义冲突。
    if (note.deadNote) return '连接技法不能用于制音';
    if (note.harmonic !== undefined) return '连接技法不能用于泛音';
    if (note.staccato) return '连接技法不能用于断音';
    if (note.letRing) return '连接技法不能用于延音';
    if (note.palmMute) return '连接技法不能用于闷音';
    return undefined;
}

function spanIssue(
    technique: ConnectingTechnique,
    previousFret: number,
    fret: number,
    playability: PlayabilityRules,
): string | undefined {
    const diff = fret - previousFret;
    const span = Math.abs(diff);

    if (technique === 'slide') {
        // 空弦没有按弦手指可移动，滑入/滑出空弦都不可演奏。
        if (previousFret < 1 || fret < 1) return '滑弦两端都不能是空弦';
        if (span < 1) return '滑弦需要品位变化';
        if (span > playability.maxSlideFrets) {
            return `滑弦品位跨度过大: ${span}`;
        }
        return undefined;
    }

    if (span < 1) return '击/勾弦需要品位变化';
    if (span > playability.maxHammerPullFrets) {
        return `击/勾弦品位跨度过大: ${span}`;
    }
    if (technique === 'hammerOn' && diff < 0) return '击弦目标品位应高于前音';
    if (technique === 'pullOff' && diff > 0) return '勾弦目标品位应低于前音';
    return undefined;
}

/** 给定连接技法是否可用于该目标音；返回 undefined 表示可用。 */
export function connectIssue(
    technique: ConnectingTechnique,
    previous: Note | undefined,
    note: Note,
    playability: PlayabilityRules,
): string | undefined {
    const base = baseIssue(previous, note, playability);
    if (base !== undefined) return base;
    // baseIssue 已保证前音与两端品位存在，这里只是给 TypeScript 收窄类型。
    if (!previous || previous.fret === undefined || note.fret === undefined) {
        return undefined;
    }
    return spanIssue(technique, previous.fret, note.fret, playability);
}
