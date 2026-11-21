/**
 * 谱面编辑光标（只读定位，不承载音符数据）。
 *
 * `beatOffset` 与 `measureTotalBeats` 同单位（全音符 = 1）；
 * `string` 用应用弦号（1 = 高音 E / 最顶线）。
 */
export interface EditCursor {
    /** 小节索引（0 起） */
    measureIndex: number;
    /** 小节内拍偏移（slot 起点；小节尾 = 该小节总拍数） */
    beatOffset: number;
    /** 应用弦号 1-6 */
    string: number;
}
