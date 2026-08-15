/**
 * 文本绘制（公共底层方法）
 *
 * 所有谱面文字（品位数字、技法标签、小节编号等）都共用此方法。
 */

export interface TextOptions {
    /** 字体颜色 */
    color?: string;
    /** 字体样式（如 'bold 11px monospace'） */
    font?: string;
    /** 水平对齐（'left' | 'center' | 'right'） */
    align?: CanvasTextAlign;
    /** 垂直对齐（'top' | 'middle' | 'bottom' | 'alphabetic'） */
    baseline?: CanvasTextBaseline;
}

/**
 * 绘制文本
 */
export function drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options: TextOptions = {},
): void {
    const {
        color = '#eee',
        font = 'normal 11px sans-serif',
        align = 'center',
        baseline = 'alphabetic',
    } = options;

    ctx.save();
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, x, y);
    ctx.restore();
}
