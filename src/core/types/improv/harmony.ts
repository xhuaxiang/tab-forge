/**
 * 和弦、和弦进行与和声计划。
 */

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
 * 显式和弦事件：在第 `measure` 小节的 `start` 位置换和弦。
 *
 * `start` 以全音符为单位（4/4 一小节 = 1）；`chord` 可以是级数或显式
 * 和弦，级别解析仍在和声层完成。一小节内按 start 升序形成多个和弦段。
 */
export interface ChordEvent {
    /** 小节下标，0-based */
    measure: number;
    /** 相对小节起点的位置（全音符为单位） */
    start: number;
    chord: ProgressionStep;
}

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

/** 小节内的和弦段；start/duration 与小节容量同单位（全音符=1） */
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
