/**
 * 扫弦箭头渲染
 *
 * 在和弦符头右侧绘制一条粗箭头，
 * 表示快速扫过琴弦方向。
 */

import type { Note } from '../../types/index.ts';
import { COLORS, LAYOUT } from '../constants.ts';

export interface StrumArrowOptions {
    /** 和弦包含的所有音符 */
    notes: Note[];
    /** 和弦的 X 坐标 */
    x: number;
    /** 所在行的顶部 Y 坐标 */
    rowTopY: number;
    /** 扫弦方向：'down'（从低到高，下扫）| 'up'（从高到低，上扫） */
    direction: 'up' | 'down';
}

/**
 * 渲染扫弦箭头
 *
 * 在符头右侧画一条粗箭头，从和弦最低弦到最高弦（或反向）。
 *
 * @param ctx     Canvas 上下文
 * @param options 扫弦选项
 */
export function renderStrumArrow(
    ctx: CanvasRenderingContext2D,
    options: StrumArrowOptions,
): void {
    const { notes, x, rowTopY, direction } = options;

    if (notes.length < 2) return;

    // 找出和弦覆盖的弦范围
    const sortedNotes = [...notes].sort((a, b) => (a.string || 0) - (b.string || 0));
    const minString = sortedNotes[0].string || 1;
    const maxString = sortedNotes[sortedNotes.length - 1].string || 6;

    // 计算 Y 范围
    const yTop = rowTopY + (minString - 1) * LAYOUT.lineSpacing;
    const yBottom = rowTopY + (maxString - 1) * LAYOUT.lineSpacing;

    // 箭头放在符头右侧偏移位置
    const arrowX = x + LAYOUT.noteRadius + 5;
    const midY = (yTop + yBottom) / 2;
    const lineLen = (yBottom - yTop) * 0.6;
    const arrowSize = 5;

    ctx.save();
    ctx.strokeStyle = COLORS.accent;
    ctx.fillStyle = COLORS.accent;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';

    if (direction === 'down') {
        // 下扫：从低到高（箭头朝上）
        const startY = midY + lineLen / 2;
        const endY = midY - lineLen / 2;
        ctx.beginPath();
        ctx.moveTo(arrowX, startY);
        ctx.lineTo(arrowX, endY + arrowSize);
        ctx.stroke();
        // 箭头
        ctx.beginPath();
        ctx.moveTo(arrowX, endY - arrowSize);
        ctx.lineTo(arrowX - arrowSize, endY);
        ctx.lineTo(arrowX + arrowSize, endY);
        ctx.closePath();
        ctx.fill();
    } else {
        // 上扫：从高到低（箭头朝下）
        const startY = midY - lineLen / 2;
        const endY = midY + lineLen / 2;
        ctx.beginPath();
        ctx.moveTo(arrowX, startY);
        ctx.lineTo(arrowX, endY - arrowSize);
        ctx.stroke();
        // 箭头
        ctx.beginPath();
        ctx.moveTo(arrowX, endY + arrowSize);
        ctx.lineTo(arrowX - arrowSize, endY);
        ctx.lineTo(arrowX + arrowSize, endY);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}
