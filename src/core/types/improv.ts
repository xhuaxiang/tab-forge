/**
 * 本地即兴类型与乐理常量的公共出口。
 *
 * 具体声明拆在 `improv/` 下：`options`（音阶/风格/密度/生成选项）、
 * `harmony`（和弦与和声计划）、`plan`（乐句/节奏/骨架/把位）、
 * `style`（密度与风格参数）、`playability`（可演奏性）、
 * `localConfig`（完整配置与生成结果）。这里只做显式 re-export，
 * 保证外部 `core/types/improv.ts` 的 import 路径不变。
 *
 * 与 `types/index.ts` 分开：这里的类型是生成链的中间表示，不扩 `Note`
 * 的字段，也不反向被 `types/index.ts` 引用。
 */

export {
    CHORD_QUALITIES,
    CHORD_INTERVALS,
} from './improv/harmony.ts';
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
} from './improv/harmony.ts';

export {
    SCALE_TYPES,
    LOCAL_STYLES,
    LOCAL_DENSITIES,
    SCALE_INTERVALS,
} from './improv/options.ts';
export type {
    ScaleType,
    LocalStyle,
    LocalDensity,
    FretRange,
    ImprovOptions,
    ResolvedImprovOptions,
} from './improv/options.ts';

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
} from './improv/plan.ts';

export type {
    DurationWeight,
    DensityProfile,
    PhraseProfile,
    StyleProfile,
} from './improv/style.ts';

export type { PlayabilityRules } from './improv/playability.ts';

export type {
    LocalImprovConfig,
    LocalImprovResult,
} from './improv/localConfig.ts';
