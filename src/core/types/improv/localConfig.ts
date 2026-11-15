/**
 * 本地即兴的完整配置与生成结果。
 */

import type { Note } from '../note/index.ts';
import type { Tuning } from '../tuning/index.ts';
import type { HarmonyMeasure } from './harmony.ts';
import type {
    LocalDensity,
    LocalStyle,
    PracticeFocus,
    PracticeProfile,
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
    /** 练习意图预设；只缩放表现层概率/跳进/把位，不改音高选择 */
    practiceProfiles: Record<PracticeFocus, PracticeProfile>;
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
    /**
     * 本次实际生效的单步最大音程（已叠加练习预设与 playability）。
     * 补丁应用器必须用同一口径复检，否则练习模式收紧的跳进会被 AI 绕过。
     */
    maxLeapSemitones: number;
}
