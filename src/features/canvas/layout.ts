/**
 * 布局模块
 *
 * 负责将乐谱小节分配到各行（自动换行）、构建音符位置信息。
 */

import type { Measure } from '../../core/types/index.ts';
import type { RowLayout, NotePositionInfo, SlotEntry } from '../../core/types/canvas.ts';
import { LAYOUT } from './constants.ts';
import { measureToSlotCount, buildSlotEntries } from '../../core/utils/measureUtils.ts';

/**
 * 将带时值的 slot 条目按拍子单位展平。
 * 例如 beatUnit=0.25（4/4拍）时：
 *   - duration=1 的条目展开为 [note, empty, empty, empty] (4拍)
 *   - duration=0.5 的条目展开为 [note, empty] (2拍)
 *   - duration=0.25 的条目保持 [note] (1拍)
 */
export function expandSlotsByBeat(
    entries: SlotEntry[],
    beatUnit: number,
): { notes: NotePositionInfo['notes']; isRest?: boolean; arpeggio?: 'up' | 'down'; strum?: 'up' | 'down' }[] {
    const result: { notes: NotePositionInfo['notes']; isRest?: boolean; arpeggio?: 'up' | 'down'; strum?: 'up' | 'down' }[] = [];

    for (const entry of entries) {
        const beats = Math.round(entry.duration / beatUnit);
        // 第一个拍位放置音符
        result.push({
            notes: entry.notes,
            isRest: entry.isRest,
            arpeggio: entry.arpeggio,
            strum: entry.strum,
        });
        // 后续拍位补空
        for (let b = 1; b < beats; b++) {
            result.push({ notes: [], isRest: true });
        }
    }

    return result;
}

// ============================================================
// 换行布局算法
// ============================================================

/**
 * 将小节分配到各行，支持自动换行
 * 当小节累计宽度超过画布可用宽度时，自动换到新行，
 * 在新行重新绘制完整的六线谱（弦标签+六线+音符）
 */
export function layoutRows(measures: Measure[], canvasWidth: number): RowLayout[] {
    const rows: RowLayout[] = [];

    if (measures.length === 0) return rows;

    // 可用宽度（给音符的水平空间）
    const contentLeftX = LAYOUT.paddingLeft + LAYOUT.stringLabelWidth + 4;
    const contentRightX = canvasWidth - LAYOUT.paddingRight;
    const availableWidth = contentRightX - contentLeftX;

    // 计算每个小节的"音符宽度需求"
    interface MeasureWidthInfo {
        measure: Measure;
        noteCount: number;
    }

    const measureInfos: MeasureWidthInfo[] = measures.map((m) => {
        const beatUnit = 1 / m.timeSignatureDenominator;
        const noteCount = Math.max(measureToSlotCount(m, beatUnit), 1);
        return { measure: m, noteCount };
    });

    let currentRow: Measure[] = [];
    let currentRowNoteCount = 0;
    let startIdx = 0;

    // 与 buildNotePositions 保持一致的 measureGap 计算
    const projectedMeasureGap = Math.min(LAYOUT.measureGap, availableWidth * 0.04);

    for (let i = 0; i < measureInfos.length; i++) {
        const info = measureInfos[i];

        const tempNoteCount = currentRowNoteCount + info.noteCount;
        const tempMeasureCount = currentRow.length + 1;

        // 计算添加该小节后的投影音符间距（与 buildNotePositions 一致）
        const projectedSpacing = tempMeasureCount > 1
            ? (availableWidth - (tempMeasureCount - 1) * projectedMeasureGap) / tempNoteCount
            : availableWidth / tempNoteCount;

        // 间距低于最小阈值 → 换行（单小节独占一行时不强制拆分）
        if (projectedSpacing < LAYOUT.minNoteSpacing && currentRow.length > 0) {
            const notePositions = buildNotePositions(currentRow, startIdx, canvasWidth);
            rows.push({
                measures: currentRow,
                startMeasureIdx: startIdx,
                notePositions,
            });

            currentRow = [info.measure];
            currentRowNoteCount = info.noteCount;
            startIdx = i;
        } else {
            currentRow.push(info.measure);
            currentRowNoteCount = tempNoteCount;
        }
    }

    if (currentRow.length > 0) {
        const notePositions = buildNotePositions(currentRow, startIdx, canvasWidth);
        rows.push({
            measures: currentRow,
            startMeasureIdx: startIdx,
            notePositions,
        });
    }

    return rows;
}

// ============================================================
// 音符位置构建
// ============================================================

/**
 * 构建行内所有音符的精确 X 坐标，并计算每个位置所属的拍数
 * 支持：
 * - notes[] 每个单独占一个拍位（单音模式）
 * - chords[] 每个和弦内多个音符共享一个拍位（和弦模式）
 * - 时值扩展：全音符展开为4拍，二分音符展开为2拍
 */
export function buildNotePositions(
    measures: Measure[],
    startMeasureIdx: number,
    canvasWidth: number,
): NotePositionInfo[] {
    const positions: NotePositionInfo[] = [];
    const contentLeftX = LAYOUT.paddingLeft + LAYOUT.stringLabelWidth + 4;

    // 计算该行总拍位数（按展开后的实际拍位）
    const totalSlots = measures.reduce((sum, m) => {
        const beatUnit = 1 / m.timeSignatureDenominator;
        return sum + Math.max(measureToSlotCount(m, beatUnit), 1);
    }, 0);

    // 可用宽度
    const contentRightX = canvasWidth - LAYOUT.paddingRight;
    const availableWidth = contentRightX - contentLeftX;

    // 计算间距
    const measureGap = Math.min(LAYOUT.measureGap, availableWidth * 0.04);
    const spacingTotal = availableWidth - (measures.length - 1) * measureGap;
    const spacing = Math.max(
        Math.min(spacingTotal / totalSlots, LAYOUT.noteSpacing * 1.5),
        LAYOUT.minNoteSpacing,
    );

    let cursorX = contentLeftX;

    for (let mIdx = 0; mIdx < measures.length; mIdx++) {
        const measure = measures[mIdx];
        const globalMeasureIdx = startMeasureIdx + mIdx;

        // 拍号信息
        const beatUnit = 1 / measure.timeSignatureDenominator;
        const beatsPerMeasure = measure.timeSignatureNumerator;

        // 构建并展开拍位
        const entries = buildSlotEntries(measure);
        const expandedSlots = expandSlotsByBeat(entries, beatUnit);

        const totalSlotsInMeasure = Math.max(expandedSlots.length, 1);

        // 计算每个拍位对应的拍数
        const slotBeats: Map<number, number> = new Map();
        let currentBeat = 0;

        for (let sIdx = 0; sIdx < expandedSlots.length; sIdx++) {
            slotBeats.set(sIdx, currentBeat);
            currentBeat++;
            if (currentBeat >= beatsPerMeasure) {
                currentBeat = beatsPerMeasure - 1;
            }
        }

        // 空小节
        if (expandedSlots.length === 0) {
            positions.push({
                x: cursorX + spacing / 2,
                notes: [],
                measureIdx: globalMeasureIdx,
                positionInMeasure: 0,
                beat: 0,
            });
        } else {
            for (let sIdx = 0; sIdx < expandedSlots.length; sIdx++) {
                const slot = expandedSlots[sIdx];
                const noteX = cursorX + spacing / 2 + sIdx * spacing;
                positions.push({
                    x: noteX,
                    notes: slot.notes,
                    measureIdx: globalMeasureIdx,
                    positionInMeasure: sIdx,
                    beat: slotBeats.get(sIdx) || 0,
                    isRest: slot.isRest,
                    arpeggio: slot.arpeggio,
                    strum: slot.strum,
                });
            }
        }

        cursorX += totalSlotsInMeasure * spacing + measureGap;
    }

    return positions;
}
