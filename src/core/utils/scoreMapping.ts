/**
 * scoreMapping — alphaTab ↔ 应用数据映射（纯函数，无 DOM，可单测）
 *
 * 两个方向都在本文件，保持成对：
 * - 写入侧「应用 → alphaTab」：scoreAdapter 构造谱面时用；
 * - 读入侧「alphaTab → 应用」：点击谱面回填表单时用。
 * 与 scoreEditing 分离，保证在 Node 测试环境下可导入。
 *
 * 签名只用 core/types 的类型、原始值与 alphaTab 的 model 类型/枚举
 * （CLAUDE.md 允许的第三方类型），故不读 store、不碰 DOM。
 */

import { model } from '@coderline/alphatab';
import type { NoteDuration } from '../types/index.ts';

export type AppTechnique = 'none' | 'hammerOn' | 'pullOff' | 'slide' | 'bend' | 'vibrato';

// ============================================================
// 写入侧：应用 → alphaTab
// ============================================================

/** 音名基音 → 半音（C=0 … B=11），供 noteNameToMidi 解析音名 */
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

/**
 * 应用弦号 → alphaTab 弦号。
 * 应用 1=高音E(最顶线)..6=低音E；alphaTab 1=最底弦。故取 7 - n。
 */
export function appStringToAlphaString(appString: number): number {
    return 7 - appString;
}

/** 应用时值（相对值）→ alphaTab Duration 枚举值；未知时值回落到四分音符 */
export function appDurationToAlpha(d: NoteDuration): model.Duration {
    switch (d) {
        case 1: return model.Duration.Whole;
        case 0.5: return model.Duration.Half;
        case 0.25: return model.Duration.Quarter;
        case 0.125: return model.Duration.Eighth;
        case 0.0625: return model.Duration.Sixteenth;
        case 0.03125: return model.Duration.ThirtySecond;
        default: return model.Duration.Quarter;
    }
}

// ============================================================
// 读入侧：alphaTab → 应用
// ============================================================

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
