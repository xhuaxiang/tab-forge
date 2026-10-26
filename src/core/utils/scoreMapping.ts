/**
 * scoreMapping — 应用 ↔ alphaTab 的通用换算（纯函数，无 DOM，可单测）
 *
 * 按**换算主题**成组，不按「哪边用」分节：同一个换算的两个方向（弦号、时值）
 * 放在一起、共用一份实现——分开写只会各自漂移。
 *
 * 与 scoreEditing 分离，保证在 Node 测试环境下可导入。
 * 签名只用 core/types 的类型、原始值与 alphaTab 的 model 类型/枚举
 * （CLAUDE.md 允许的第三方类型），故不读 store、不碰 DOM。
 */

import { model } from '@coderline/alphatab';
import type { NoteDuration, AppTechnique, AppHarmonic } from '../types/index.ts';
import { NATURAL_SEMITONE } from '../types/index.ts';

// 技法取值只有一份：core/types 的 AppTechnique（由 Note.technique 派生）
export type { AppTechnique } from '../types/index.ts';
export type { AppHarmonic } from '../types/index.ts';

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

// ============================================================
// 泛音（应用 ↔ alphaTab）
// ============================================================

/** 应用泛音类型 → alphaTab `HarmonicType` */
export function appHarmonicToAlpha(h: AppHarmonic): model.HarmonicType {
    switch (h) {
        case 'natural': return model.HarmonicType.Natural;
        case 'artificial': return model.HarmonicType.Artificial;
        case 'pinch': return model.HarmonicType.Pinch;
    }
}

/**
 * 触弦点（品位差）→ alphaTab `Note.harmonicValue`。
 *
 * alphaTab 的换算表在私有的 `ModelUtils.deltaFretToHarmonicValue` 里，没有导出，
 * 这里按同一张表复刻一份（含非整数特例）。改动前先核对 1.8.x 的实现。
 */
export function deltaFretToHarmonicValue(deltaFret: number): number {
    switch (deltaFret) {
        case 2: return 2.4;
        case 3: return 3.2;
        case 4: return 4;
        case 5: return 5;
        case 7: return 7;
        case 8: return 8.2;
        case 9: return 9;
        case 10: return 9.6;
        case 12: return 12;
        case 14: return 14.7;
        case 15: return 14.7;
        case 16: return 16;
        case 17: return 17;
        case 19: return 19;
        case 21: return 21.7;
        case 22: return 21.7;
        case 24: return 24;
        default: return 12;
    }
}

/**
 * alphaTab `harmonicValue` → 实际升高的半音数。
 *
 * 与 `deltaFretToHarmonicValue` 不构成简单逆映射：alphaTab 发声时按区间查表，
 * 例如 12 品泛音升高 12 个半音，而 5 品泛音升高 24 个半音（两个八度）。
 * 自然泛音再叠加空弦音高，人工/捏弦泛音叠加按弦音高（见 Karplus audioEngine）。
 */
export function harmonicValueToSemitones(value: number): number {
    const is = (v: number): boolean => Math.abs(value - v) < 1e-6;
    if (is(2.4)) return 36;
    if (is(2.7)) return 34;
    if (value < 3) return 0;
    if (value <= 3.5) return 31;
    if (value <= 4) return 28;
    if (value <= 5) return 24;
    if (value <= 6) return 34;
    if (value <= 7) return 19;
    if (value <= 8.5) return 36;
    if (value <= 9) return 28;
    if (value <= 10) return 34;
    if (value <= 11) return 0;
    if (value <= 12) return 12;
    if (value < 14) return 0;
    if (value <= 15) return 34;
    if (value <= 16) return 28;
    if (value <= 17) return 36;
    if (value <= 18) return 0;
    if (value <= 19) return 19;
    if (value <= 21) return 0;
    if (value <= 22) return 36;
    if (value <= 24) return 24;
    return 0;
}

/**
 * alphaTab `harmonicValue` → 触弦点（品位差），用于点击谱面回填表单。
 *
 * 只对 `deltaFretToHarmonicValue` 会产生的非整数特例做映射；
 * 其余值直接四舍五入（GP 导入的非常规值可能回填得不够精确，但不会崩）。
 *
 * 注意有损之处：14/15 都写成 14.7、21/22 都写成 21.7，回填只能取前一个；
 * 2.7 仅来自外部谱面（本应用写谱不会产生），回填为 3 会改变音高但不会崩。
 */
export function harmonicValueToDeltaFret(value: number): number {
    const special: Array<[number, number]> = [
        [2.4, 2], [2.7, 3], [3.2, 3], [8.2, 8], [9.6, 10], [14.7, 14], [21.7, 21],
    ];
    for (const [v, fret] of special) {
        if (Math.abs(value - v) < 1e-6) return fret;
    }
    return Math.round(value);
}

/**
 * 把任意触弦点规范化到 alphaTab 支持的泛音节点。
 *
 * `deltaFretToHarmonicValue` 对表外的值会回落到 12（六/十一/十三/十八/二十/二十三品等）。
 * 写进 Note 之前先走一遍，否则「存的值 ≠ 谱面显示的值 ≠ 点击回填的值」：
 * 用户填 6，谱面按 12 品发声，回填却变回 12。15/22 会规范化成等价音高的 14/21。
 */
export function normalizeHarmonicFret(deltaFret: number): number {
    if (!Number.isFinite(deltaFret)) return 12;
    return harmonicValueToDeltaFret(deltaFretToHarmonicValue(Math.round(deltaFret)));
}

/** alphaTab Note 上可回填到表单的奏法/泛音字段 */
export interface DetectedArticulations {
    palmMute: boolean;
    deadNote: boolean;
    letRing: boolean;
    staccato: boolean;
    harmonic?: AppHarmonic;
    harmonicFret?: number;
}

/** alphaTab Note → 应用奏法/泛音（纯函数） */
export function detectArticulations(n: model.Note): DetectedArticulations {
    const result: DetectedArticulations = {
        palmMute: n.isPalmMute,
        deadNote: n.isDead,
        letRing: n.isLetRing,
        staccato: n.isStaccato,
    };

    switch (n.harmonicType) {
        case model.HarmonicType.Natural:
            result.harmonic = 'natural';
            break;
        case model.HarmonicType.Artificial:
            result.harmonic = 'artificial';
            result.harmonicFret = harmonicValueToDeltaFret(n.harmonicValue);
            break;
        case model.HarmonicType.Pinch:
            result.harmonic = 'pinch';
            result.harmonicFret = harmonicValueToDeltaFret(n.harmonicValue);
            break;
        default:
            break;
    }

    return result;
}
