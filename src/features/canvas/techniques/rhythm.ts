/**
 * 时值指示器渲染（符干/符尾/连beam）
 *
 * 画法结构：在六线谱下方画符干（竖线）+ 符尾（曲线）/ 连beam（矩形条）。
 * 用于四分、八分、十六分、三十二分音符的时值表示。
 *
 * 全音符/二分音符不在此处理（它们用粗横线表示，由 longNoteBar 处理）。
 */

import type { NotePositionInfo } from '../../../core/types/canvas.ts';
import { COLORS, LAYOUT } from '../constants.ts';
import { getDurationSymbol } from '../duration.ts';

/**
 * 渲染时值指示器（符干 + 符尾/连beam）
 *
 * @param ctx        Canvas 上下文
 * @param positions  该行所有音符位置信息
 * @param string6Y   第6弦 Y 坐标
 */
export function renderRhythm(
    ctx: CanvasRenderingContext2D,
    positions: NotePositionInfo[],
    string6Y: number,
): void {
    if (positions.length === 0) return;

    const stemBottomY = string6Y + LAYOUT.stemHeight;

    // 收集需要画符干的位置（排除全音符/二分音符）
    const activePositions: NotePositionInfo[] = [];
    for (const p of positions) {
        if (p.notes.length === 0) continue;
        const duration = p.notes[0].duration;
        if (duration === 0.25 || duration === 0.125 || duration === 0.0625 || duration === 0.03125) {
            activePositions.push(p);
        }
    }

    if (activePositions.length === 0) return;

    // 绘制符干（向下）
    for (const pos of activePositions) {
        ctx.save();
        ctx.strokeStyle = COLORS.durationLine;
        ctx.lineWidth = LAYOUT.stemWidth;
        ctx.beginPath();
        ctx.moveTo(pos.x, string6Y);
        ctx.lineTo(pos.x, stemBottomY);
        ctx.stroke();
        ctx.restore();
    }

    // 分组绘制连beam (符尾)
    renderBeams(ctx, activePositions, string6Y, stemBottomY);
}

// ============================================================
// 内部：符尾/连beam 绘制
// ============================================================

function renderBeams(
    ctx: CanvasRenderingContext2D,
    activePositions: NotePositionInfo[],
    string6Y: number,
    stemBottomY: number,
): void {
    if (activePositions.length === 0) return;

    let groupStart = 0;

    for (let i = 1; i <= activePositions.length; i++) {
        const currentPos = i < activePositions.length ? activePositions[i] : null;
        const prevPos = activePositions[i - 1];

        const currentDur = currentPos ? currentPos.notes[0].duration : null;
        const prevDur = prevPos.notes[0].duration;

        // 时值变化或跨小节时断开分组
        const durChanged = currentDur === null || currentDur !== prevDur;
        const measureChanged = currentPos !== null && currentPos.measureIdx !== prevPos.measureIdx;

        if (durChanged || measureChanged) {
            const group = activePositions.slice(groupStart, i);
            const duration = prevDur;
            const symbol = getDurationSymbol(duration);
            const flagCount = symbol.flagCount;

            if (flagCount > 0) {
                if (group.length === 1) {
                    drawSingleFlag(ctx, group[0], flagCount, stemBottomY);
                } else {
                    drawBeamGroup(ctx, group, flagCount, string6Y, stemBottomY);
                }
            }

            groupStart = i;
        }
    }
}

function drawSingleFlag(
    ctx: CanvasRenderingContext2D,
    pos: NotePositionInfo,
    flagCount: number,
    stemBottomY: number,
): void {
    ctx.save();
    ctx.strokeStyle = COLORS.durationLine;
    ctx.lineWidth = 1.0;

    for (let i = 0; i < flagCount; i++) {
        const flagY = stemBottomY + i * 5;
        ctx.beginPath();
        ctx.moveTo(pos.x, flagY);
        ctx.quadraticCurveTo(
            pos.x + 6 + i * 1.5,
            flagY + 5,
            pos.x + 8 + i * 2,
            flagY + LAYOUT.flagHeight,
        );
        ctx.stroke();
    }
    ctx.restore();
}

function drawBeamGroup(
    ctx: CanvasRenderingContext2D,
    positions: NotePositionInfo[],
    flagCount: number,
    string6Y: number,
    stemBottomY: number,
): void {
    const firstX = positions[0].x;
    const lastX = positions[positions.length - 1].x;

    ctx.save();
    ctx.fillStyle = COLORS.beamFill;

    for (let i = 0; i < flagCount; i++) {
        const beamY = stemBottomY + i * 4 - 1;
        const beamHeight = 2.5;
        const startX = firstX - 1;
        const endX = lastX + 1;

        if (endX > startX) {
            ctx.fillRect(startX, beamY, endX - startX, beamHeight);
        }
    }

    // 绘制每个位置的符干（到最下面的beam）
    ctx.strokeStyle = COLORS.durationLine;
    ctx.lineWidth = LAYOUT.stemWidth;

    for (const pos of positions) {
        const beamCount = flagCount;
        const bottomBeamY = stemBottomY + (beamCount - 1) * 4 - 1;
        ctx.beginPath();
        ctx.moveTo(pos.x, string6Y);
        ctx.lineTo(pos.x, bottomBeamY);
        ctx.stroke();
    }
    ctx.restore();
}
