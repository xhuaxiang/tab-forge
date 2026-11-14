/**
 * 乐谱容器类型。
 *
 * 命名不用 `Score`：alphaTab 有 `model.Score`，`scoreAdapter.ts` 正在使用；
 * `ScoreBase` 与 `NoteBase` / `MeasureBase` 保持一套后缀，子类型只补
 * 乐器特有字段（六线谱是 `tuning`）。
 */

import type { Measure, MeasureBase } from '../measure/index.ts';
import type { Tuning } from '../tuning/index.ts';

/**
 * 所有乐器谱共有的头部信息与小节容器。
 *
 * 泛型参数让子类型可以收窄小节形态（六线谱用 `Measure`，未来钢琴用
 * `PianoMeasure`），基类本身不引入 `tuning` 这类六线谱专属字段。
 */
export interface ScoreBase<M extends MeasureBase = MeasureBase> {
    /** 标题 */
    title: string;
    /** 艺术家/来源 */
    artist: string;
    /** BPM */
    bpm: number;
    /** 小节列表 */
    measures: M[];
    /** 曲调 (Key) */
    key?: string;
    /** 全局拍号（如 "4/4"），默认 "4/4" */
    timeSignature: string;
    /** 备注 */
    remarks?: string;
}

/** 完整的乐谱（六线谱）：公共头部 + 调弦 */
export interface TabScore extends ScoreBase<Measure> {
    /** 调弦 */
    tuning: Tuning;
}

/** 和弦图 */
export interface ChordDiagram {
    /** 和弦名称 (如 Am, C, G7) */
    name: string;
    /** 各弦按的品位，0=空弦，-1=不弹 */
    frets: number[];
    /** 每根弦用哪根手指按 (1=食指, 2=中指, 3=无名指, 4=小指) */
    fingers: number[];
}
