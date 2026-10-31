/**
 * 本地即兴生成的数据类型与乐理常量。
 *
 * 与 `types/index.ts` 分开：`Note` 是持久化/AI 契约的数据，这里是
 * 生成链内部的中间表示（节奏计划、旋律骨架、把位、风格参数），
 * 不扩 `Note` 的字段，也不反向被 `types/index.ts` 引用。
 */

import type { Note, NoteDuration, Tuning } from './index.ts';

// ============================================================
// 选项与配置
// ============================================================

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

// ============================================================
// 和弦与和声计划
// ============================================================

/** 和弦质量：三和弦 + 常用七和弦 */
export const CHORD_QUALITIES = [
    'major',
    'minor',
    'diminished',
    'augmented',
    'major7',
    'minor7',
    'dominant7',
    'halfDiminished7',
    'diminished7',
] as const;
export type ChordQuality = (typeof CHORD_QUALITIES)[number];

/** 和弦音程（相对根音的半音数） */
export const CHORD_INTERVALS: Record<ChordQuality, readonly number[]> = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    diminished: [0, 3, 6],
    augmented: [0, 4, 8],
    major7: [0, 4, 7, 11],
    minor7: [0, 3, 7, 10],
    dominant7: [0, 4, 7, 10],
    halfDiminished7: [0, 3, 6, 10],
    diminished7: [0, 3, 6, 9],
};

/** 一个和弦：根音 pitch class + 质量 */
export interface ChordSpec {
    rootPitchClass: number;
    quality: ChordQuality;
}

/** 调内级数（1-7） */
export type ChordDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * 和弦进行的一步。
 *
 * - 数字：按当前音阶生成调内三和弦（例如大调 2 → Dm）；
 * - 显式和弦：直接指定根音与质量，允许使用调外和弦。
 */
export type ProgressionStep = ChordDegree | ChordSpec;

/** 和弦进行：按小节铺开，最后一小节落在进行的最后一步 */
export type Progression = readonly ProgressionStep[];

/**
 * 一个小节/和弦段的可用音池（pitch class）。
 *
 * `chordPitchClasses` 是强拍目标；`passingPitchClasses` 可在弱拍使用；
 * `avoidPitchClasses` 位于和弦音上方小二度，只允许在短经过音中出现。
 */
export interface PitchPool {
    chordPitchClasses: number[];
    availablePitchClasses: number[];
    passingPitchClasses: number[];
    avoidPitchClasses: number[];
}

/** 小节内的和弦段；v1 一小节一个和弦，start=0、duration=小节容量 */
export interface HarmonySegment {
    /** 相对小节起点的位置（全音符为单位） */
    start: number;
    /** 持续时值（全音符为单位） */
    duration: number;
    chord: ChordSpec;
    pool: PitchPool;
}

/** 一小节的和声上下文 */
export interface HarmonyMeasure {
    measureIndex: number;
    segments: HarmonySegment[];
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
    seed: number;
}

// ============================================================
// 节奏计划
// ============================================================

/** 拍位在律动中的角色：强拍 / 弱拍 / 经过音 */
export type SlotRole = 'strong' | 'weak' | 'passing';

/** 一个小节内的拍位（休止也占一个拍位） */
export interface RhythmSlot {
    duration: NoteDuration;
    isRest: boolean;
    role: SlotRole;
}

/** 一小节的节奏计划；slots 时值之和恰好等于 capacity */
export interface RhythmMeasure {
    index: number;
    capacity: number;
    slots: RhythmSlot[];
}

// ============================================================
// 旋律骨架
// ============================================================

/**
 * 音高骨架拍位。
 *
 * v1 单声部：midis 长度为 0（休止）或 1；保留数组是为了以后双音
 * 能直接把 DP 状态扩成 voicing，而不用重写整条管线。
 */
export interface SkeletonSlot {
    measureIndex: number;
    slotIndex: number;
    duration: NoteDuration;
    isRest: boolean;
    /** MIDI 音号，v1 长度 0/1 */
    midis: number[];
    role: SlotRole;
}

// ============================================================
// 把位
// ============================================================

/** 一个 (弦, 品) 候选位置 */
export interface FretPosition {
    /** 应用侧弦号 1-6（1=高音 E） */
    string: number;
    fret: number;
    midi: number;
}

/** 骨架拍位 + DP 选出的位置 */
export interface PositionedSlot {
    skeleton: SkeletonSlot;
    /** 与 skeleton.midis 一一对应；休止为 [] */
    positions: FretPosition[];
}

// ============================================================
// 风格与可演奏性
// ============================================================

/** 时值权重（用于加权随机选择） */
export interface DurationWeight {
    duration: NoteDuration;
    weight: number;
}

/** 密度参数：只决定音符疏密与休止比例，不描述风格 */
export interface DensityProfile {
    durations: readonly DurationWeight[];
    /** 每个拍位成为休止的概率（每小节第一个拍位强制为音符） */
    restProbability: number;
    /** 每小节至少保留的发音数 */
    minNotesPerMeasure: number;
}

/** 风格参数：全部是机器可读的数字，不是 AI prompt 文案 */
export interface StyleProfile {
    /** 风格偏好的时值权重，与密度权重共同决定节奏 */
    durations: readonly DurationWeight[];
    /** 偏好把位（品位，含端点） */
    preferredFretMin: number;
    preferredFretMax: number;
    /** 旋律中心音高（MIDI） */
    registerCenterMidi: number;
    /** 旋律围绕中心音的音域宽度（半音） */
    registerRangeSemitones: number;
    /** 单步最大音程（半音） */
    maxLeapSemitones: number;
    /** 动机长度（音数） */
    motifLength: number;
    /** 重复已有动机的概率 */
    repetitionProbability: number;
    /** 强拍重音概率 */
    accentProbability: number;
    /** 弱拍轻音概率 */
    softProbability: number;
    /** 推弦概率（仅 Blues/Jazz/Rock 非零） */
    bendProbability: number;
    /** 揉弦概率 */
    vibratoProbability: number;
    /** 手掌闷音概率（仅低音弦） */
    palmMuteProbability: number;
}

/**
 * 可演奏性参数。
 *
 * 品位范围、单步音程与技法最短时值由生成器/校验硬性检查；
 * `maxHandSpan`、`maxStringJump` 只作为把位 DP 的高额代价（软约束），
 * 因为换把时允许暂时超出同一把位的手距。
 */
export interface PlayabilityRules {
    fretMin: number;
    fretMax: number;
    /** 同一把位内的品位跨度；超过后 DP 加重代价（不硬性禁止换把） */
    maxHandSpan: number;
    /** 允许的跨弦数；超过后 DP 加重代价（不硬性禁止大跨弦） */
    maxStringJump: number;
    /** 单步最大音程（半音），与风格取更严者；校验会强制执行 */
    maxLeapSemitones: number;
    /** 允许推弦的最短时值 */
    minBendDuration: NoteDuration;
    /** 允许「推上去再放回」的最短时值（释放需要更多时间） */
    minBendReleaseDuration: NoteDuration;
    /** 允许揉弦的最短时值 */
    minVibratoDuration: NoteDuration;
    /** 允许手掌闷音的最短时值 */
    minPalmMuteDuration: NoteDuration;
    /** 允许手掌闷音的最粗弦范围 [最低弦号, 最高弦号]（4-6） */
    palmMuteStrings: readonly [number, number];
}

/** 本地即兴的完整配置 */
export interface LocalImprovConfig {
    numMeasures: {
        default: number;
        min: number;
        max: number;
        options: readonly number[];
    };
    timeSignatures: readonly string[];
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
}
