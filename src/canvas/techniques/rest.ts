/**
 * 休止符渲染
 *
 * 画法结构：在谱线下方绘制休止符符号。
 */

import { COLORS, LAYOUT } from '../constants.ts';
import { drawText } from '../draw/text.ts';
import { getRestSymbol } from '../duration.ts';
import type { NoteDuration } from '../../types/index.ts';

/**
 * 渲染休止符
 *
 * @param ctx      Canvas 上下文
 * @param x        休止符 X 坐标
 * @param rowTopY  所在行的顶部 Y 坐标
 * @param duration 休止符时值
 */
export function renderRest(
    ctx: CanvasRenderingContext2D,
    x: number,
    rowTopY: number,
    duration: NoteDuration,
): void {
    const y = rowTopY + 3 * LAYOUT.lineSpacing - (LAYOUT.lineSpacing - LAYOUT.fontSize.title) / 2;
    const symbol = getRestSymbol(duration);

    drawText(ctx, symbol, x, y, {
        color: COLORS.textDim,
        font: `normal ${LAYOUT.fontSize.title.toString()}px sans-serif`,
    });
}
