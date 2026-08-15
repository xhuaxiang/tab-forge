/**
 * 弧线绘制（公共底层方法）
 *
 * 所有弧线（延音弧线、击弦弧线、勾弦弧线、滑弦弧线）都共用此方法。
 * 仅负责"怎么画"，不关心"画的是什么技法"。
 */

export interface ArcOptions {
    /** 线条颜色 */
    color?: string;
    /** 线宽 */
    lineWidth?: number;
    /** 弧线弯曲方向偏移量（向上为负值，默认 -12） */
    bendOffset?: number;
}

/**
 * 绘制一条二次贝塞尔弧线
 *
 * @param ctx     Canvas 上下文
 * @param x1      起点 X
 * @param x2      终点 X
 * @param y       基线 Y（弧线从此高度弯曲）
 * @param options 样式选项
 */
export function drawArc(
    ctx: CanvasRenderingContext2D,
    x1: number,
    x2: number,
    y: number,
    options: ArcOptions = {},
): void {
    const {
        color = 'rgba(150,150,150,0.5)',
        lineWidth = 1.5,
        bendOffset = -12,
    } = options;

    const midX = (x1 + x2) / 2;
    const midY = y + bendOffset;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.quadraticCurveTo(midX, midY, x2, y);
    ctx.stroke();
    ctx.restore();
}
