/**
 * 单音渲染
 *
 * 画法结构：一个品位数字 + 一个符头圆圈。
 * 对应普通拨弦、点弦等单一音符的渲染。
 */

import { COLORS, LAYOUT } from '../constants.ts';
import { drawText } from '../draw/text.ts';

export interface SingleNoteOptions {
    /** 弦号 */
    string: number;
    /** 品位 */
    fret: number;
    /** 是否在长时值跨度中（如果为 true，只画符头+数字，不额外加标签） */
    inLongSpan?: boolean;
    /** 是否为长时值起始位置 */
    isLongSpanStart?: boolean;
}

/**
 * 渲染单个音符
 *
 * @param ctx     Canvas 上下文
 * @param x       音符 X 坐标
 * @param y       音符 Y 坐标（对应弦的 Y 位置）
 * @param options 音符选项
 */
export function renderSingleNote(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    options: SingleNoteOptions,
): void {
    const { fret } = options;

    // 画品位数字
    drawText(ctx, String(fret), x, y + LAYOUT.fontSize.fret / 3, {
        color: COLORS.textDim,
        font: `bold ${LAYOUT.fontSize.fret}px monospace`,
    });
}
