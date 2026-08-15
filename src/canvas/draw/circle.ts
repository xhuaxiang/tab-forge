/**
 * 圆圈绘制（公共底层方法）
 *
 * 用于音符符头、泛音标记等需要圆形图元的地方。
 */

export interface CircleOptions {
    /** 填充颜色 */
    fillColor?: string;
    /** 描边颜色 */
    strokeColor?: string;
    /** 线宽 */
    lineWidth?: number;
    /** 半径 */
    radius?: number;
}

/**
 * 绘制一个空心圆（带半透明填充 + 彩色描边）
 * 默认样式适用吉他六线谱符头
 */
export function drawCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    options: CircleOptions = {},
): void {
    const {
        fillColor = 'rgba(255,255,255,0.10)',
        strokeColor = '#aaa',
        lineWidth = 1.2,
        radius = 7,
    } = options;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);

    if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
    }

    if (strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }
    ctx.restore();
}
