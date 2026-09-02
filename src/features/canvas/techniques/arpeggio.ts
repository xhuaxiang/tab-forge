/**
 * 琶音波浪线渲染
 *
 * 在和弦符头左侧绘制一条竖波浪线 𝆃，
 * 表示从低音弦到高音弦依次快速拨过（或反方向）。
 */

import type { Note } from '../../../core/types/index.ts';
import { COLORS, LAYOUT } from '../constants.ts';

export interface ArpeggioOptions {
    /** 和弦包含的所有音符 */
    notes: Note[];
    /** 和弦的 X 坐标 */
    x: number;
    /** 所在行的顶部 Y 坐标 */
    rowTopY: number;
    /** 琶音方向：'up'（从低到高，默认）| 'down'（从高到低） */
    direction: 'up' | 'down';
}

/**
 * 渲染琶音竖波浪线
 *
 * 在符头左侧画一条波浪线，从和弦最低弦到最高弦。
 * 波浪线由多个小弧线（半波）首尾相接构成。
 *
 * @param ctx     Canvas 上下文
 * @param options 琶音选项
 */
export function renderArpeggio(
    ctx: CanvasRenderingContext2D,
    options: ArpeggioOptions,
): void {
    const { notes, x, rowTopY, direction } = options;

    if (notes.length < 2) return;

    // 找出和弦覆盖的弦范围（按弦号排序）
    const sortedNotes = [...notes].sort((a, b) => (a.string || 0) - (b.string || 0));
    const minString = sortedNotes[0].string || 1;
    const maxString = sortedNotes[sortedNotes.length - 1].string || 6;

    // 计算 Y 范围
    const yTop = rowTopY + (minString - 1) * LAYOUT.lineSpacing;
    const yBottom = rowTopY + (maxString - 1) * LAYOUT.lineSpacing;

    // 波浪线放在符头左侧偏移位置
    const waveX = x - LAYOUT.noteRadius - 6;

    // 波浪参数
    const waveAmplitude = 3;     // 水平振幅（左右摆动的像素）
    const waveCount = Math.max(notes.length * 2 - 1, 3); // 半波数量
    const waveStep = (yBottom - yTop) / waveCount;
    const arrowSize = 4;         // 箭头大小

    ctx.save();
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.2;

    // ----- 画波浪线 -----
    ctx.beginPath();

    if (direction === 'up') {
        // 从低弦（yBottom）到高弦（yTop）
        ctx.moveTo(waveX, yBottom);
        for (let i = 1; i <= waveCount; i++) {
            const y = yBottom - i * waveStep;
            const isEven = i % 2 === 0;
            const cpX = isEven ? waveX - waveAmplitude : waveX + waveAmplitude;
            const prevY = yBottom - (i - 1) * waveStep;
            ctx.quadraticCurveTo(cpX, (prevY + y) / 2, waveX, y);
        }
    } else {
        // 从高弦（yTop）到低弦（yBottom）
        ctx.moveTo(waveX, yTop);
        for (let i = 1; i <= waveCount; i++) {
            const y = yTop + i * waveStep;
            const isEven = i % 2 === 0;
            const cpX = isEven ? waveX - waveAmplitude : waveX + waveAmplitude;
            const prevY = yTop + (i - 1) * waveStep;
            ctx.quadraticCurveTo(cpX, (prevY + y) / 2, waveX, y);
        }
    }

    ctx.stroke();

    // ----- 画方向箭头（在终点） -----
    const arrowY = direction === 'up' ? yTop : yBottom;

    ctx.fillStyle = COLORS.accent;
    ctx.beginPath();
    if (direction === 'up') {
        // 箭头朝上
        ctx.moveTo(waveX, arrowY - arrowSize);
        ctx.lineTo(waveX - arrowSize, arrowY);
        ctx.lineTo(waveX + arrowSize, arrowY);
    } else {
        // 箭头朝下
        ctx.moveTo(waveX, arrowY + arrowSize);
        ctx.lineTo(waveX - arrowSize, arrowY);
        ctx.lineTo(waveX + arrowSize, arrowY);
    }
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}