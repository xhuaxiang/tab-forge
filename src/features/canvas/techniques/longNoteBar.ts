/**
 * 长时值粗横线渲染
 *
 * 画法结构：在弦上画一条粗横线，跨越整个时值范围。
 * 用于全音符（duration=1）和二分音符（duration=0.5）的时值表示。
 * 粗横线在弦线上方绘制，颜色和弦颜色一致。
 */

import { STRING_COLORS, COLORS } from '../constants.ts';
import type { NoteDuration } from '../../../core/types/index.ts';

/** 长时值跨度信息 */
export interface LongNoteBarInfo {
    /** 弦号 */
    string: number;
    /** 起始拍位索引 */
    startIdx: number;
    /** 结束拍位索引 */
    endIdx: number;
    /** 时值 */
    duration: NoteDuration;
}

/** 时值标签映射 */
export const DUR_LABELS: Record<number, string> = { 1: '全', 0.5: '1/2' };

/**
 * 渲染长时值粗横线和时值标签
 *
 * @param ctx           Canvas 上下文
 * @param x             起始 X 坐标
 * @param endX          结束 X 坐标
 * @param y             弦的 Y 坐标
 * @param stringNum     弦号
 * @param duration      时值
 * @param labelY        时值标签的 Y 坐标（通常在第6弦下方）
 */
export function renderLongNoteBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    endX: number,
    y: number,
    stringNum: number,
    duration: NoteDuration,
    labelY: number,
    strokeColor: string
): void {
    ctx.save();
    ctx.strokeStyle = strokeColor || STRING_COLORS[stringNum];
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
    ctx.restore();

    // 时值标签（如"全"、"1/2"）
    const label = DUR_LABELS[duration];
    if (label) {
        const textCtx = ctx;
        textCtx.save();
        textCtx.fillStyle = COLORS.textBright;
        textCtx.font = '9px sans-serif';
        textCtx.textAlign = 'center';
        textCtx.fillText(label, x, labelY);
        textCtx.restore();
    }
}
