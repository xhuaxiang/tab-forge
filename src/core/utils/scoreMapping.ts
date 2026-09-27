/**
 * scoreMapping — 应用 ↔ alphaTab 的通用换算（纯函数，无 DOM，可单测）
 *
 * 按**换算主题**成组，不按「哪边用」分节：同一个换算的两个方向（弦号、时值）
 * 放在一起、共用一份实现——分开写只会各自漂移。
 * 工具是通用的：`canvas ↮ alphaTab`、`karplus ↮ soundfont` 管的是**实现**
 * 互不混入，管不到本文件，两边都可以 import。
 *
 * 与 scoreEditing 分离，保证在 Node 测试环境下可导入。
 * 签名只用 core/types 的类型、原始值与 alphaTab 的 model 类型/枚举
 * （CLAUDE.md 允许的第三方类型），故不读 store、不碰 DOM。
 */

import { model } from '@coderline/alphatab';
import type { NoteDuration, AppTechnique } from '../types/index.ts';
import { NATURAL_SEMITONE } from '../types/index.ts';

// 技法取值只有一份：core/types 的 AppTechnique（由 Note.technique 派生）
export type { AppTechnique } from '../types/index.ts';

// ============================================================
// 音名 → MIDI 音号
// ============================================================

/** 音名（如 'E4'、'Eb4'、'D#4'）→ MIDI 音号；解析失败返回 0 */
export function noteNameToMidi(noteName: string): number {
    const m = noteName.trim().match(/^([A-Ga-g])([#b]?)(\d{1,2})$/);
    if (!m) return 0;
    // 基音查 core/types 的共享表（单一来源），升降号仍走算术，罕见拼写（E#/Cb）行为不变
    const letter = m[1].toUpperCase();
    let semi = NATURAL_SEMITONE[letter];
    if (m[2] === '#') semi += 1;
    else if (m[2] === 'b') semi -= 1;
    const octave = parseInt(m[3], 10);
    return (octave + 1) * 12 + semi;
}

// ============================================================
// 弦号（双向）
// ============================================================

/**
 * 弦号互换：应用 1=高音E(最顶线)..6=低音E ↔ alphaTab 1=最底弦。
 *
 * 两个方向是**同一个自逆变换**（7 - n），共用这一份实现；
 * 下面两个导出名只是为了在调用处读出方向，别再各写一遍公式。
 */
export function flipStringNumber(n: number): number {
    return 7 - n;
}

/** alphaTab 弦号 → 应用弦号 */
export const alphaStringToAppString = flipStringNumber;

/** 应用弦号 → alphaTab 弦号 */
export const appStringToAlphaString = flipStringNumber;

// ============================================================
// 时值（双向）
// ============================================================

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

/**
 * alphaTab Duration → 全音符分数（Quarter→0.25），与 `measureTotalBeats` 同单位。
 *
 * 这是反向换算的**唯一实现**；`alphaDurationToAppDuration` 只是同一数值换了个口径声明。
 */
export function alphaDurationToWholeNote(d: model.Duration): number {
    return 1 / (d as number);
}

/**
 * alphaTab Duration → 应用时值（相对值）。
 *
 * 数值与 `alphaDurationToWholeNote` 完全相同，差别只在返回类型：
 * 这里声明为 `NoteDuration`，但**断言不做运行时校验**——传入
 * `model.Duration.SixtyFourth`（=64）会返回 0.015625，并不在 `NoteDuration` 全集内，
 * 调用方不可假定返回值一定是合法时值。
 */
export function alphaDurationToAppDuration(d: model.Duration): NoteDuration {
    return alphaDurationToWholeNote(d) as NoteDuration;
}

// ============================================================
// 拍位与技法（alphaTab → 应用）
// ============================================================

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
