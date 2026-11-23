/**
 * connect — 连接类技法（击/勾/滑）的可演奏判定。
 *
 * 生成（decorate）与校验（validate）共用这一份判断，避免两边的
 * 同弦、前音、跨度、方向规则各自漂移。
 */

import type { Note } from '../../types/index.ts';
import type { PlayabilityRules } from '../../types/improv/index.ts';
import type { ConnectingTechnique } from '../technique.ts';
import { canSourceTechnique } from '../technique.ts';
import { t } from '../../i18n/index.ts';

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
        return t('improv.connect.missingPrevious');
    }
    if (previous.string === undefined || note.string === undefined
        || previous.string !== note.string) {
        return t('improv.connect.differentString');
    }
    if (previous.fret === undefined || note.fret === undefined) {
        return t('improv.connect.missingFret');
    }
    if (!canSourceTechnique(previous)) {
        return t('improv.connect.previousMuted');
    }
    // 泛音要重新拨弦且是另一套音色，不能复用它的缓冲区做连接源。
    if (previous.harmonic !== undefined) {
        return t('improv.connect.previousHarmonic');
    }
    if (previous.technique === 'bend' || previous.technique === 'vibrato') {
        return t('improv.connect.previousBendVibrato');
    }
    if (note.duration < playability.minConnectDuration) {
        return t('improv.connect.tooShort');
    }
    // 目标音不重新拨弦；带独立奏法的目标与连接语义冲突。
    if (note.deadNote) return t('improv.connect.targetDead');
    if (note.harmonic !== undefined) return t('improv.connect.targetHarmonic');
    if (note.staccato) return t('improv.connect.targetStaccato');
    if (note.letRing) return t('improv.connect.targetLetRing');
    if (note.palmMute) return t('improv.connect.targetPalmMute');
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
        if (previousFret < 1 || fret < 1) return t('improv.connect.slideOpenString');
        if (span < 1) return t('improv.connect.slideNeedsFretChange');
        if (span > playability.maxSlideFrets) {
            return t('improv.connect.slideSpanTooLarge', { span });
        }
        return undefined;
    }

    if (span < 1) return t('improv.connect.hammerNeedsFretChange');
    if (span > playability.maxHammerPullFrets) {
        return t('improv.connect.hammerSpanTooLarge', { span });
    }
    if (technique === 'hammerOn' && diff < 0) return t('improv.connect.hammerTargetHigher');
    if (technique === 'pullOff' && diff > 0) return t('improv.connect.pullTargetLower');
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
