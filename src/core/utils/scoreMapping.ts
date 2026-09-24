/**
 * scoreMapping — alphaTab ↔ 应用数据映射（纯函数，无 DOM，可单测）
 *
 * 与 scoreEditing 分离，保证在 Node 测试环境下可导入。
 */

import { model } from '@coderline/alphatab';
import type { NoteDuration } from '../types/index.ts';

export type AppTechnique = 'none' | 'hammerOn' | 'pullOff' | 'slide' | 'bend' | 'vibrato';

/** alphaTab 弦号（1=最低弦）→ 应用弦号（1=高音E） */
export function alphaStringToAppString(alphaString: number): number {
    return 7 - alphaString;
}

/** alphaTab Duration 枚举值 → 应用时值（相对值） */
export function alphaDurationToAppDuration(d: model.Duration): NoteDuration {
    return (1 / (d as number)) as NoteDuration;
}

/** alphaTab Duration → 全音符分数（Quarter→0.25），与 measureTotalBeats 同单位 */
export function alphaDurationToWholeNote(d: model.Duration): number {
    return 1 / (d as number);
}

/** 该 beat 在小节内的拍偏移（全音符=1） */
export function beatOffsetInMeasure(beat: model.Beat): number {
    let offset = 0;
    for (const b of beat.voice.beats) {
        if (b === beat) break;
        offset += alphaDurationToWholeNote(b.duration);
    }
    return offset;
}

/**
 * alphaTab Note → 应用技法
 *
 * @param fallbackBendAmount 无 maxBendPoint 时的推弦幅度回退值（由调用方传入，保持本函数为纯函数）
 */
export function detectTechnique(n: model.Note, fallbackBendAmount: number): { tech: AppTechnique; targetFret?: number; bendAmount?: number; bendRelease?: boolean } {
    if (n.vibrato !== model.VibratoType.None) return { tech: 'vibrato' };

    if (n.bendType !== model.BendType.None) {
        return {
            tech: 'bend',
            bendAmount: n.maxBendPoint ? n.maxBendPoint.value / 4 : fallbackBendAmount,
            bendRelease: n.bendType === model.BendType.BendRelease,
        };
    }

    if (n.slideOutType !== model.SlideOutType.None || n.slideInType !== model.SlideInType.None || n.slideOrigin) {
        const target = n.slideOutType !== model.SlideOutType.None ? (n.slideTarget?.fret ?? n.fret) : n.fret;
        return { tech: 'slide', targetFret: target };
    }

    if (n.isHammerPullOrigin || n.isHammerPullDestination) {
        const other = n.isHammerPullOrigin ? n.hammerPullDestination : n.hammerPullOrigin;
        const isHammer = other !== null && other.fret > n.fret;
        return { tech: isHammer ? 'hammerOn' : 'pullOff', targetFret: other?.fret ?? n.fret };
    }

    return { tech: 'none' };
}
