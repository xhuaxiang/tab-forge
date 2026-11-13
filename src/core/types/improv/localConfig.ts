/**
 * 本地即兴的完整配置与生成结果。
 */

import type { Note } from '../note.ts';
import type { Tuning } from '../tuning.ts';
import type { HarmonyMeasure } from './harmony.ts';
import type {
    LocalDensity,
    LocalStyle,
    ResolvedImprovOptions,
    ScaleType,
} from './options.ts';
import type { PhrasePlan } from './plan.ts';
import type { PlayabilityRules } from './playability.ts';
import type { DensityProfile, StyleProfile } from './style.ts';

/** 本地即兴的完整配置 */
export interface LocalImprovConfig {
    numMeasures: {
        default: number;
        min: number;
        max: number;
        options: readonly number[];
    };
    timeSignatures: readonly string[];
    /** 每小节和弦数（等分）；1 表示沿用 progression 的逐小节铺法 */
    chordsPerMeasure: {
        default: number;
        options: readonly number[];
    };
    defaults: {
        numMeasures: number;
        key: string;
        scaleType: ScaleType;
        style: LocalStyle;
        density: LocalDensity;
        timeSignature: string;
        tuning: Tuning;
        seed: number;
    };
    styleProfiles: Record<LocalStyle, StyleProfile>;
    densityProfiles: Record<LocalDensity, DensityProfile>;
    playability: PlayabilityRules;
}

/** 生成结果：Note[] 可直接交给 scoreStore.loadNotes */
export interface LocalImprovResult {
    notes: Note[];
    options: ResolvedImprovOptions;
    /** 每小节实际使用的和弦与可用音池（仅生成期数据，不写入 Score） */
    harmony: HarmonyMeasure[];
    /** 本次生成的乐句计划（仅生成期数据） */
    phrases: PhrasePlan[];
}
