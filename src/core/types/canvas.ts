/**
 * 渲染内部辅助类型
 */

import type { Measure, Note, NoteDuration } from './index.ts';

/** 每行布局信息 */
export interface RowLayout {
    /** 该行包含的小节 */
    measures: Measure[];
    /** 该行全局起始小节索引 */
    startMeasureIdx: number;
    /** 该行音符位置信息 */
    notePositions: NotePositionInfo[];
}

/** 单个音符位置信息 */
export interface NotePositionInfo {
    /** 水平 X 坐标 */
    x: number;
    /** 该位置的全部音符（可能多弦同时发音） */
    notes: Note[];
    /** 所属小节索引（全局） */
    measureIdx: number;
    /** 在该小节内的第几个位置 */
    positionInMeasure: number;
    /** 所属拍数（从0开始，基于拍号计算） */
    beat: number;
    /** 是否为休止符位置 */
    isRest?: boolean;
    /** 琶音方向（仅和弦位有效） */
    arpeggio?: 'up' | 'down';
    /** 扫弦方向（仅和弦位有效） */
    strum?: 'up' | 'down';
}

/** 内部拍位条目 */
export interface SlotEntry {
    notes: Note[];
    duration: NoteDuration;
    isRest?: boolean;
    /** 琶音方向（仅和弦位有效） */
    arpeggio?: 'up' | 'down';
    /** 扫弦方向（仅和弦位有效） */
    strum?: 'up' | 'down';
}

