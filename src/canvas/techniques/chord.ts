/**
 * 和弦渲染
 *
 * 画法结构：多个音符数字在同一 X 坐标上纵向排列（多弦同时发音）。
 * 和弦中的每个音符本质上也是单音，所以复用 singleNote 的绘制逻辑。
 */

import type { Note } from '../../types/index.ts';
import { LAYOUT } from '../constants.ts';
import { renderSingleNote } from './singleNote.ts';

/**
 * 渲染和弦（同一拍位多弦同时发音）
 *
 * @param ctx       Canvas 上下文
 * @param x         和弦 X 坐标
 * @param rowTopY   所在行的顶部 Y 坐标
 * @param notes     该和弦包含的所有音符（来自不同弦）
 */
export function renderChord(
    ctx: CanvasRenderingContext2D,
    x: number,
    rowTopY: number,
    notes: Note[],
): void {
    // 按弦号从高到低（6→1）排序，确保低音弦先画（避免覆盖高音弦）
    const sorted = [...notes].sort((a, b) => (b.string ?? 0) - (a.string ?? 0));

    for (const note of sorted) {
        if (!note.string || note.string < 1 || note.string > 6) continue;
        const y = rowTopY + (note.string - 1) * LAYOUT.lineSpacing;
        renderSingleNote(ctx, x, y, {
            string: note.string,
            fret: note.fret ?? 0,
        });
    }
}
