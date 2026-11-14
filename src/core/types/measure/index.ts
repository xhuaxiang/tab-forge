/**
 * 小节数据模型。
 *
 * `MeasureBase` 只装所有乐器共有的小节骨架；`notes` 的形态留给子类型
 * （钢琴双谱表会换成左右手/高低音谱表，而不是一条 `Note[]`）。
 */

import type { Note } from '../note/index.ts';

/** 所有乐器小节共有的字段 */
export interface MeasureBase {
    /** 小节序号 (从0开始) */
    index: number;
    /** 拍号 - 分子 (默认4) */
    timeSignatureNumerator: number;
    /** 拍号 - 分母 (默认4) */
    timeSignatureDenominator: number;
}

/** 单个小节（六线谱）：拍号 + 该小节的音符 */
export interface Measure extends MeasureBase {
    /** 小节内的所有拍位，按添加顺序排列（单音/休止符/和弦音符统一在此） */
    notes: Note[];
}
