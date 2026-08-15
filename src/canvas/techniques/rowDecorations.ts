/**
 * 行装饰渲染
 *
 * 包含：
 *   1. 弦标签（e| B| G| D| A| E|）
 *   2. 背景六线（水平线）
 *   3. 行底小节编号
 */

import { STRING_NAMES } from '../../types/index.ts';
import type { NotePositionInfo } from '../../types/canvas.ts';
import { COLORS, STRING_COLORS, LAYOUT } from '../constants.ts';

/**
 * 弦标签和六线
 *
 * @param ctx          Canvas 上下文
 * @param rowTopY      所在行的顶部 Y 坐标
 * @param contentLeft  内容区域左边界
 * @param contentRight 内容区域右边界
 * @param labelRightX  标签右侧对齐位置
 */
export function renderStrings(
    ctx: CanvasRenderingContext2D,
    rowTopY: number,
    contentLeft: number,
    contentRight: number,
    labelRightX: number,
): void {
    // 弦标签
    for (let s = 1; s <= 6; s++) {
        const y = rowTopY + (s - 1) * LAYOUT.lineSpacing;
        ctx.save();
        ctx.fillStyle = STRING_COLORS[s];
        ctx.font = `bold ${LAYOUT.fontSize.stringLabel}px monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`${STRING_NAMES[s]}|`, labelRightX - 4, y + 4);
        ctx.restore();
    }

    // 背景六线（水平线）
    for (let s = 1; s <= 6; s++) {
        const y = rowTopY + (s - 1) * LAYOUT.lineSpacing;
        ctx.save();
        ctx.strokeStyle = COLORS.lineDim;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(contentLeft, y);
        ctx.lineTo(contentRight, y);
        ctx.stroke();
        ctx.restore();
    }
}

/** 小节编号信息 */
interface MeasureNumInfo {
    measureIdx: number;
    centerX: number;
}

/**
 * 行底小节编号
 *
 * @param ctx       Canvas 上下文
 * @param positions 该行音符位置信息
 * @param rowTopY   所在行的顶部 Y 坐标
 */
export function renderMeasureNumbers(
    ctx: CanvasRenderingContext2D,
    positions: NotePositionInfo[],
    rowTopY: number,
): void {
    if (positions.length === 0) return;

    // 按小节分组，计算每组中心 X
    const measureNumbers: MeasureNumInfo[] = [];
    let currentMeasureIdx = -1;
    let groupPositions: NotePositionInfo[] = [];

    for (const pos of positions) {
        if (pos.measureIdx !== currentMeasureIdx) {
            if (groupPositions.length > 0) {
                measureNumbers.push({
                    measureIdx: currentMeasureIdx,
                    centerX: (groupPositions[0].x + groupPositions[groupPositions.length - 1].x) / 2,
                });
            }
            groupPositions = [pos];
            currentMeasureIdx = pos.measureIdx;
        } else {
            groupPositions.push(pos);
        }
    }
    if (groupPositions.length > 0) {
        measureNumbers.push({
            measureIdx: currentMeasureIdx,
            centerX: (groupPositions[0].x + groupPositions[groupPositions.length - 1].x) / 2,
        });
    }

    const numberY = rowTopY + 6 * LAYOUT.lineSpacing + 14;

    ctx.save();
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `${LAYOUT.fontSize.measureNum}px sans-serif`;
    ctx.textAlign = 'center';

    for (const info of measureNumbers) {
        ctx.fillText(`小节 ${info.measureIdx + 1}`, info.centerX, numberY);
    }
    ctx.restore();
}
