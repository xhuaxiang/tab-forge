/**
 * 本地即兴的选项、音阶/风格/密度取值与补齐后的配置。
 */

import type { Tuning } from '../tuning/index.ts';
import type { ChordEvent, Progression } from './harmony.ts';

/** 本地生成支持的音阶（取值与 IMPROV_CONFIG.scaleTypes 保持一致） */
export const SCALE_TYPES = [
    'Major (Ionian)',
    'Natural Minor (Aeolian)',
    'Harmonic Minor',
    'Pentatonic Major',
    'Pentatonic Minor',
    'Blues',
    'Dorian',
    'Mixolydian',
] as const;
export type ScaleType = (typeof SCALE_TYPES)[number];

/** 本地生成支持的风格（取值与 IMPROV_CONFIG.styles 保持一致） */
export const LOCAL_STYLES = ['Jazz', 'Blues', 'Rock', 'Folk', 'Classical'] as const;
export type LocalStyle = (typeof LOCAL_STYLES)[number];

/** 本地生成支持的密度（取值与 IMPROV_CONFIG.densities 保持一致） */
export const LOCAL_DENSITIES = ['低', '中', '高'] as const;
export type LocalDensity = (typeof LOCAL_DENSITIES)[number];

/**
 * 标准五型指法（国内通行口径）。
 *
 * 以「关系大调」级数命名：Mi=3、Sol=5、La=6、Si=7、Re=2。锚点是 6 弦上
 * 该级音的最低可用品位，窗口固定 4 品（C 大调 La = 5-8 品）。
 */
export const FINGERING_PATTERNS = ['Mi', 'Sol', 'La', 'Si', 'Re'] as const;
export type FingeringPattern = (typeof FINGERING_PATTERNS)[number];

/** 练习意图：只调整表现密度/跳进/把位，不改变音高选择算法 */
export const PRACTICE_FOCUSES = ['none', 'fretboard', 'ear', 'technique', 'warmup'] as const;
export type PracticeFocus = (typeof PRACTICE_FOCUSES)[number];

/** 练习预设（数值本体在 core/config.ts 的 LOCAL_IMPROV_CONFIG.practiceProfiles） */
export interface PracticeProfile {
    /** 表情类概率的统一乘数；建议保持 > 0 */
    expressionScale: number;
    /** 收紧风格 maxLeapSemitones（只收紧不放大）；null = 不覆盖 */
    maxLeapSemitones: number | null;
    /** 无显式把位时锁定到风格低把位的 4 品窗口 */
    keepPosition: boolean;
}

/**
 * 音阶音程（相对主音的半音数）。
 *
 * Blues 用六音蓝调音阶（小调五声 + b5），与 AI hint 的
 * 「小调五声 + b3/b5/b7」一致；不是七声音阶。
 */
export const SCALE_INTERVALS: Record<ScaleType, readonly number[]> = {
    'Major (Ionian)': [0, 2, 4, 5, 7, 9, 11],
    'Natural Minor (Aeolian)': [0, 2, 3, 5, 7, 8, 10],
    'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
    'Pentatonic Major': [0, 2, 4, 7, 9],
    'Pentatonic Minor': [0, 3, 5, 7, 10],
    'Blues': [0, 3, 5, 6, 7, 10],
    'Dorian': [0, 2, 3, 5, 7, 9, 10],
    'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
};

/** 用户锁定的把位范围（品位，含端点，0-24） */
export interface FretRange {
    min: number;
    max: number;
}

/** 生成选项：全部可选，缺省值由 resolveLocalImprovOptions 补齐 */
export interface ImprovOptions {
    numMeasures?: number;
    key?: string;
    scaleType?: ScaleType;
    style?: LocalStyle;
    density?: LocalDensity;
    timeSignature?: string;
    tuning?: Tuning;
    /** 和弦进行；不传时按 I 级主和弦，保持原有行为 */
    progression?: Progression;
    /**
     * 显式多和弦位置；非空时覆盖 `progression` 的逐小节铺法，
     * 未覆盖的小节仍按 `progression` 兜底。
     */
    chordChart?: readonly ChordEvent[];
    /** 用户锁定的把位范围；不传时按风格偏好 */
    fretRange?: FretRange;
    /** 标准五型指法；显式 fretRange 优先于它 */
    fingering?: FingeringPattern;
    /** 练习意图；不传时视为 none */
    practice?: PracticeFocus;
    /** 固定种子；不传时由 UI 生成，core 默认 1 */
    seed?: number;
}

/**
 * AI 需求解析允许覆盖的字段子集。
 *
 * 与 `ImprovOptions` 分开，编译期禁止 AI 注入 `tuning` / `seed` /
 * `chordChart`。`chordsPerMeasure` 只存在于 brief 侧，合并后由 UI
 * 展开成 `chordChart`。
 */
export type ImprovBriefOptions = Pick<
    ImprovOptions,
    | 'numMeasures'
    | 'key'
    | 'scaleType'
    | 'style'
    | 'density'
    | 'timeSignature'
    | 'fingering'
    | 'fretRange'
    | 'progression'
> & {
    /** 每个和弦占几小节；缺省 / 1 表示逐小节铺 */
    chordsPerMeasure?: number;
};

/** 补齐缺省值后的生成选项 */
export interface ResolvedImprovOptions {
    numMeasures: number;
    /** 原始调性写法（如 C / Am），用于状态栏与复现 */
    key: string;
    /** 主音 pitch class 0-11 */
    tonicPitchClass: number;
    scaleType: ScaleType;
    style: LocalStyle;
    density: LocalDensity;
    timeSignature: string;
    tuning: Tuning;
    progression: Progression;
    /** 规范化后的显式和弦事件；空数组表示只按 progression 铺 */
    chordChart: readonly ChordEvent[];
    /** 规范化后的用户把位；null 表示未锁定，按风格偏好 */
    fretRange: FretRange | null;
    /** 把位来源：重试阶梯据此判断窄窗是用户显式要的还是推理出来的 */
    fretRangeSource: 'explicit' | 'fingering' | 'practice' | 'style';
    /** 规范化后的五型指法；null 表示未指定 */
    fingering: FingeringPattern | null;
    /** 规范化后的练习意图（缺省 none） */
    practice: PracticeFocus;
    seed: number;
}
