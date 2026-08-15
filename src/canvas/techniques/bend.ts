/**
 * 推弦渲染
 *
 * 推弦是单音符技法，在音符上方绘制向上的弧线/箭头，
 * 标注推弦幅度（1/4、1/2、Full）以及是否释放回来。
 */

import { drawText } from '../draw/text.ts';

/** 推弦幅度标签映射 */
const BEND_LABELS: Record<number, string> = {
    0.25: '1/4',
    0.5: '1/2',
    1: 'Full',
};

/** 推弦颜色 */
const BEND_COLOR = '#4fc3f7';

export interface BendOptions {
    /** 推弦幅度（半音数） */
    bendAmount: number;
    /** 是否推弦后释放 */
    bendRelease?: boolean;
}

/**
 * 渲染推弦标记
 *
 * 在音符上方绘制向上的弧线 + 幅度标签。
 * 如果是 bend-release，弧线先向上再弯回。
 *
 * @param ctx     Canvas 上下文
 * @param x       音符 X 坐标
 * @param y       音符所在弦的 Y 坐标
 * @param options 推弦选项
 */
export function renderBend(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    options: BendOptions,
): void {
    const { bendAmount, bendRelease = false } = options;

    // 弧线高度与推弦幅度成正比
    const arcHeight = 8 + bendAmount * 14; // Full≈22px, 1/2≈15px, 1/4≈11.5px
    const endX = x + 14;
    const midX = (x + endX) / 2;

    ctx.save();
    ctx.strokeStyle = BEND_COLOR;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';

    if (bendRelease) {
        // ---- 推弦后释放：弧线先向上再弯回 ----
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(midX, y - arcHeight, endX, y);
        ctx.stroke();
    } else {
        // ---- 普通推弦：弧线向上 ----
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(midX, y - arcHeight, endX, y - arcHeight * 0.5);
        ctx.stroke();

        // 箭头尖端（小三角形）
        const tipX = endX;
        const tipY = y - arcHeight * 0.5;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - 4, tipY + 3);
        ctx.lineTo(tipX + 1, tipY);
        ctx.fillStyle = BEND_COLOR;
        ctx.fill();
    }

    // 幅度标签
    const label = BEND_LABELS[bendAmount] || `${bendAmount}`;
    const labelX = bendRelease ? endX + 6 : endX + 4;
    const labelY = bendRelease ? y - 4 : y - arcHeight * 0.5 - 2;
    drawText(ctx, label, labelX, labelY, {
        color: BEND_COLOR,
        font: `bold 8px sans-serif`,
        align: 'left',
    });

    // 释放标记
    if (bendRelease) {
        drawText(ctx, '↩', labelX + 20, labelY, {
            color: BEND_COLOR,
            font: `8px sans-serif`,
            align: 'left',
        });
    }

    ctx.restore();
}
