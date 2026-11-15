/**
 * 本地即兴类型与乐理常量的公共出口。
 *
 * 具体声明拆在同目录下：`options`（音阶/风格/密度/生成选项）、
 * `harmony`（和弦与和声计划）、`plan`（乐句/节奏/骨架/把位）、
 * `style`（密度与风格参数）、`playability`（可演奏性）、
 * `localConfig`（完整配置与生成结果）。这里只做显式 re-export。
 *
 * 与 `types/index.ts` 分开：这里的类型是生成链的中间表示，不扩 `Note`
 * 的字段，也不反向被 `types/index.ts` 引用。
 */

export {
    CHORD_QUALITIES,
    CHORD_INTERVALS,
} from './harmony.ts';
export type {
    ChordQuality,
    ChordSpec,
    ChordDegree,
    ProgressionStep,
    Progression,
    ChordEvent,
    PitchPool,
    HarmonySegment,
    HarmonyMeasure,
} from './harmony.ts';

export {
    SCALE_TYPES,
    LOCAL_STYLES,
    LOCAL_DENSITIES,
    SCALE_INTERVALS,
    FINGERING_PATTERNS,
    PRACTICE_FOCUSES,
} from './options.ts';
export type {
    ScaleType,
    LocalStyle,
    LocalDensity,
    FretRange,
    FingeringPattern,
    PracticeFocus,
    PracticeProfile,
    ImprovBriefOptions,
    ImprovOptions,
    ResolvedImprovOptions,
} from './options.ts';

export { PERFORMANCE_TECHNIQUES } from './performance.ts';
export type {
    PerformancePatch,
    PerformanceSlot,
} from './performance.ts';

export type {
    PhraseRole,
    PhraseVariation,
    MelodicContour,
    PhrasePlan,
    SlotRole,
    RhythmSlot,
    RhythmMeasure,
    SkeletonSlot,
    FretPosition,
    PositionedSlot,
} from './plan.ts';

export type {
    DurationWeight,
    DensityProfile,
    PhraseProfile,
    StyleProfile,
} from './style.ts';

export type { PlayabilityRules } from './playability.ts';

export type {
    LocalImprovConfig,
    LocalImprovResult,
} from './localConfig.ts';
