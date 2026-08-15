/**
 * 小节线渲染
 *
 * 画法结构：在六线谱上绘制竖线（小节线）。
 * 包含小节之间的分隔线、行首行尾的结束线。
 */

import { COLORS, LAYOUT } from '../constants.ts';

/**
 * 渲染小节线（在两个小节之间）
 *
 * @param ctx      Canvas 上下文
 * @param x        小节线 X 坐标
 * @param rowTopY  所在行的顶部 Y 坐标
 */
export function renderBarline(
    ctx: CanvasRenderingContext2D,
    x: number,
    rowTopY: number,
): void {
    ctx.save();
    ctx.strokeStyle = COLORS.barline;
    ctx.lineWidth = 1;

    for (let s = 1; s <= 6; s++) {
        const y = rowTopY + (s - 1) * LAYOUT.lineSpacing;
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x, y + 4);
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * 渲染行尾结束线
 *
 * @param ctx      Canvas 上下文
 * @param x        结束线 X 坐标
 * @param rowTopY  所在行的顶部 Y 坐标
 */
export function renderEndBarline(
    ctx: CanvasRenderingContext2D,
    x: number,
    rowTopY: number,
): void {
    renderBarline(ctx, x, rowTopY);
}
