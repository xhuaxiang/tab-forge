/**
 * 乐句、节奏、旋律骨架与把位的计划类型（生成链中间表示）。
 */

import type { NoteDuration } from '../note/index.ts';

/** 乐句在段落中的功能 */
export type PhraseRole = 'statement' | 'answer' | 'development' | 'cadence';

/** 乐句相对动机来源的变形方式 */
export type PhraseVariation =
    | 'literal'
    | 'tail'
    | 'sequence'
    | 'inversion'
    | 'rhythmic'
    | 'cadence';

/** 旋律轮廓 */
export type MelodicContour = 'arch' | 'ascending' | 'descending' | 'wave';

/**
 * 一句的生成计划。
 *
 * `steps` 是级数步序列，跨小节延续（不在小节边界重置）；动机变形通过
 * 复用/反向/改尾实现，而不是每小节重新抽一次随机步。
 */
export interface PhrasePlan {
    index: number;
    /** 起始小节（含） */
    startMeasure: number;
    /** 结束小节（不含） */
    endMeasure: number;
    role: PhraseRole;
    contour: MelodicContour;
    variation: PhraseVariation;
    /** 动机来源句；statement 为 null */
    sourcePhrase: number | null;
    /** 句首相对来源句的模进级数 */
    transposeSteps: number;
    /** 相对基础音区的半音偏移（保留给后续按句移调） */
    registerShift: number;
    /** 本句把位窗口（品位，含端点） */
    fretMin: number;
    fretMax: number;
    /** 级数步序列，跨小节延续 */
    steps: number[];
}

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
    /** 所属乐句下标；字段可选，兼容只测单层的旧调用 */
    phraseIndex?: number;
}

/**
 * 音高骨架拍位。
 *
 * 旋律层仍只写单声部：midis 长度为 0（休止）或 1；经过声部层
 * （`addVoicings`）后，发音拍位为 1..`maxChordVoices` 个升序 MIDI。
 */
export interface SkeletonSlot {
    measureIndex: number;
    slotIndex: number;
    duration: NoteDuration;
    isRest: boolean;
    /** MIDI 音号，v1 长度 0/1 */
    midis: number[];
    role: SlotRole;
    /** 所属乐句下标；字段可选，兼容只测单层的旧调用 */
    phraseIndex?: number;
}

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
