/**
 * 揉弦渲染
 *
 * 揉弦是单音符技法，在音符上方绘制波浪线（～～～），
 * 表示手指快速摇动琴弦产生音高波动。
 */

/** 揉弦颜色 */
const VIBRATO_COLOR = '#81c784';

/**
 * 渲染揉弦波浪线
 *
 * @param ctx  Canvas 上下文
 * @param x    音符 X 坐标
 * @param y    音符所在弦的 Y 坐标
 */
export function renderVibrato(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
): void {
    const waveY = y - 8;          // 波浪线在音符上方
    const waveLength = 6;         // 每个波长
    const waveAmplitude = 3;      // 波幅
    const waveCount = 3;          // 几个波峰

    ctx.save();
    ctx.strokeStyle = VIBRATO_COLOR;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    ctx.moveTo(x - 2, waveY);
    for (let i = 0; i <= waveCount * 2; i++) {
        const px = x - 2 + (i * waveLength) / 2;
        // 交替向上/向下
        const py = waveY + (i % 2 === 0 ? -waveAmplitude : waveAmplitude);
        ctx.lineTo(px, py);
    }

    ctx.stroke();
    ctx.restore();
}
