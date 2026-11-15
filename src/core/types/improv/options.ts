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
    /** 固定种子；不传时由 UI 生成，core 默认 1 */
    seed?: number;
}

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
    seed: number;
}
