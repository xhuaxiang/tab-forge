/**
 * 小节渲染编排
 *
 * 这是 techniques/ 目录的"指挥"模块。
 * 负责遍历一行中的所有拍位，根据每个拍位的数据特征，
 * 分派给对应的技法渲染函数。
 *
 * 职责单一：它不做具体的绘制，只做"判断该画什么，然后调用谁"。
 * 具体绘制逻辑都在各个独立的 technique 文件中。
 */

import type { NotePositionInfo, RowLayout } from '../../types/canvas.ts';
import { COLORS, LAYOUT } from '../constants.ts';
import { renderSingleNote } from './singleNote.ts';
import { renderChord } from './chord.ts';
import { renderRest } from './rest.ts';
import { renderBarline, renderEndBarline } from './barline.ts';
import { renderSlur, type SlurType } from './slur.ts';
import { renderLongNoteBar, DUR_LABELS, type LongNoteBarInfo } from './longNoteBar.ts';
import { renderArpeggio } from './arpeggio.ts';
import { renderStrumArrow } from './strumArrow.ts';
import { renderBend } from './bend.ts';
import { renderVibrato } from './vibrato.ts';

// ============================================================
// 坐标辅助
// ============================================================

export function getRowTopY(rowIndex: number): number {
    return LAYOUT.paddingTop + rowIndex * (6 * LAYOUT.lineSpacing + LAYOUT.rowGap);
}

export function getStringY(rowTopY: number, stringNum: number = 3): number {
    return rowTopY + (stringNum - 1) * LAYOUT.lineSpacing;
}

export function getContentBounds(canvasWidth: number): { left: number; right: number } {
    return {
        left: LAYOUT.paddingLeft + LAYOUT.stringLabelWidth + 4,
        right: canvasWidth - LAYOUT.paddingRight,
    };
}

// ============================================================
// 行渲染入口
// ============================================================

/**
 * 渲染单行六线谱
 */
export function renderTabRow(
    ctx: CanvasRenderingContext2D,
    row: RowLayout,
    rowIndex: number,
    canvasWidth: number,
): void {
    const rowTopY = getRowTopY(rowIndex);
    const bounds = getContentBounds(canvasWidth);
    const positions = row.notePositions;

    // ----- 1) 预处理：长时值跨拍区间 -----
    const longSpans = precomputeLongSpans(positions, row);

    // ----- 2) 按小节分组（用于小节线绘制）-----
    const measureGroups = groupByMeasure(positions);

    // ============================================================
    // 绘制顺序（从底层到上层）
    // ============================================================

    // ----- 底层：长时值粗横线（全/二分音符）-----
    renderLongNoteBars(ctx, positions, rowTopY, longSpans);

    // ----- 底层：延音弧线 + 技法弧线（H/P/S）-----
    renderAllSlurs(ctx, positions, rowTopY);

    // ----- 底层：小节线 -----
    for (let gIdx = 1; gIdx < measureGroups.length; gIdx++) {
        const prevGroup = measureGroups[gIdx - 1];
        const currGroup = measureGroups[gIdx];
        const barlineX = (prevGroup.endX + currGroup.startX) / 2;
        renderBarline(ctx, barlineX, rowTopY);
    }

    // ----- 上层：音符/休止符 -----
    renderNotesAndRests(ctx, positions, rowTopY, longSpans);

    // ----- 行尾结束线 -----
    if (measureGroups.length > 0) {
        const lastGroup = measureGroups[measureGroups.length - 1];
        const endX = lastGroup.endX;
        const barlineX = Math.min(endX + 12, bounds.right);
        renderEndBarline(ctx, barlineX, rowTopY);
    }
}

// ============================================================
// 预处理
// ============================================================

function precomputeLongSpans(
    positions: NotePositionInfo[],
    row: RowLayout,
): LongNoteBarInfo[] {
    const longSpans: LongNoteBarInfo[] = [];

    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        for (const note of pos.notes) {
            if (note.isRest) continue;
            const measure = row.measures.find(m =>
                row.startMeasureIdx + row.measures.indexOf(m) === pos.measureIdx
            );
            if (!measure) continue;
            const beatUnit = 1 / measure.timeSignatureDenominator;
            const spanBeats = Math.round(note.duration / beatUnit);
            if (spanBeats >= 2 && !note.tieToNext) {
                const endIdx = Math.min(i + spanBeats - 1, positions.length - 1);
                longSpans.push({ string: note.string as number, startIdx: i, endIdx, duration: note.duration });
            }
        }
    }

    return longSpans;
}



interface MeasureGroup {
    measureIdx: number;
    positions: NotePositionInfo[];
    startX: number;
    endX: number;
}

function groupByMeasure(positions: NotePositionInfo[]): MeasureGroup[] {
    const groups: MeasureGroup[] = [];
    let currentGroup: NotePositionInfo[] = [];
    let currentMeasureIdx = -1;

    for (const pos of positions) {
        if (pos.measureIdx !== currentMeasureIdx) {
            if (currentGroup.length > 0) {
                groups.push({
                    measureIdx: currentMeasureIdx,
                    positions: currentGroup,
                    startX: currentGroup[0].x,
                    endX: currentGroup[currentGroup.length - 1].x,
                });
            }
            currentGroup = [pos];
            currentMeasureIdx = pos.measureIdx;
        } else {
            currentGroup.push(pos);
        }
    }
    if (currentGroup.length > 0) {
        groups.push({
            measureIdx: currentMeasureIdx,
            positions: currentGroup,
            startX: currentGroup[0].x,
            endX: currentGroup[currentGroup.length - 1].x,
        });
    }

    return groups;
}

// ============================================================
// 长时值粗横线渲染
// ============================================================

function renderLongNoteBars(
    ctx: CanvasRenderingContext2D,
    positions: NotePositionInfo[],
    rowTopY: number,
    longSpans: LongNoteBarInfo[],
): void {
    if (positions.length < 2) return;
    // 固定长度
    const NOTE_BAR_LENGTH = 3
    for (const span of longSpans) {
        const y = getStringY(rowTopY, span.string);
        const endX = positions[Math.min(span.endIdx, positions.length - 1)].x;
        const labelY = getStringY(rowTopY, 6) + 12;

        renderLongNoteBar(ctx, endX, endX + NOTE_BAR_LENGTH, y, span.string, span.duration, labelY, COLORS.textBright);
    }
}

// ============================================================
// 弧线渲染（延音 + 技法 H/P/S）
// ============================================================

function renderAllSlurs(
    ctx: CanvasRenderingContext2D,
    positions: NotePositionInfo[],
    rowTopY: number,
): void {
    // 延音弧线 (tieToNext)
    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        for (const note of pos.notes) {
            if (!note.tieToNext || !note.technique) continue;

            // 找到前一个非延音位置
            const prevIdx = i- 1;
            // for (let j = i - 1; j >= 0; j--) {
            //     const prevPos = positions[j];
            //     const hasSameString = prevPos.notes.some(n => n.string === note.string && !n.tieToNext);
            //     if (hasSameString) {
            //         prevIdx = j;
            //         break;
            //     }
            // }

            if (prevIdx >= 0) {
                const prevPos = positions[prevIdx];
                const y = getStringY(rowTopY, note.string);
                renderSlur(ctx, prevPos.x, pos.x, y, { type: note.technique as SlurType, targetFret: note.targetFret });
            }
        }
    }

    // 技法弧线 (H/P/S) — 预留接口
    // 当 types.ts 中 Note 增加 technique/targetFret 字段后，在这里扩展：
    //
    // for (let i = 0; i < positions.length; i++) {
    //   const pos = positions[i];
    //   for (const note of pos.notes) {
    //     if (note.technique && note.technique !== 'none' && note.targetFret !== undefined) {
    //       const targetPos = findTechniqueTarget(positions, i, note.string, note.targetFret);
    //       if (targetPos) {
    //         const y = getStringY(rowTopY, note.string);
    //         renderSlur(ctx, pos.x, targetPos.x, y, { type: note.technique as SlurType });
    //       }
    //     }
    //   }
    // }
}

// ============================================================
// 音符/休止符渲染
// ============================================================

function renderNotesAndRests(
    ctx: CanvasRenderingContext2D,
    positions: NotePositionInfo[],
    rowTopY: number,
    longSpans: LongNoteBarInfo[]
): void {
    // 将 longSpans 按弦索引以便快速判断
    const longSpanByString = new Map<number, { startIdx: number; endIdx: number }>();
    for (const span of longSpans) {
        longSpanByString.set(span.string, { startIdx: span.startIdx, endIdx: span.endIdx });
    }

    for (let pIdx = 0; pIdx < positions.length; pIdx++) {
        const pos = positions[pIdx];

        // rest 合并进 notes, 不存在 Notes 为空
        // if (pos.notes.length === 0) {
        //     // ---- 休止符（仅真正由用户添加的休止符才渲染）----
        //     if (pos.isRest) {
        //         const duration = restDurationMap.get(pIdx) ?? 0.25;
        //         renderRest(ctx, pos.x, rowTopY, duration);
        //     }
        // } else 
        if (pos.notes.length === 1) {
            // ---- 单音 ----
            const note = pos.notes[0];
            if (note.tieToNext) continue;
            if (note.isRest) {
                const duration = note.duration || 0.25;
                renderRest(ctx, pos.x, rowTopY, duration);
                continue;
            }
            const y = getStringY(rowTopY, note.string as number);
            const spanInfo = longSpanByString.get(note.string as number);
            const inLongSpan = spanInfo !== undefined && pIdx >= spanInfo.startIdx && pIdx <= spanInfo.endIdx;

            if (inLongSpan && pIdx !== spanInfo!.startIdx) continue; // 非起始位置跳过

            renderSingleNote(ctx, pos.x, y, {
                string: note.string as number,
                fret: note.fret as number,
                inLongSpan,
                isLongSpanStart: inLongSpan && pIdx === spanInfo?.startIdx,
            });

            // 推弦标记
            if (note.technique === 'bend' && note.bendAmount) {
                renderBend(ctx, pos.x, y, {
                    bendAmount: note.bendAmount,
                    bendRelease: note.bendRelease,
                });
            }

            // 揉弦标记
            if (note.technique === 'vibrato') {
                renderVibrato(ctx, pos.x, y);
            }

            // 长时值标签（全/二分音符标记）
            if (inLongSpan && pIdx === spanInfo?.startIdx) {
                const label = DUR_LABELS[note.duration] || '';
                if (label) {
                    const labelY = getStringY(rowTopY, 6) + 12;
                    ctx.save();
                    ctx.fillStyle = COLORS.textDim;
                    ctx.font = '9px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(label, pos.x, labelY);
                    ctx.restore();
                }
            }
        } else {
            // ---- 和弦（多个音符同拍位）----
                        const nonTieNotes = pos.notes.filter(n => !n.tieToNext);
            if (nonTieNotes.length > 0) {
                renderChord(ctx, pos.x, rowTopY, nonTieNotes);
                // 琶音波浪线
                if (pos.arpeggio) {
                    renderArpeggio(ctx, {
                        notes: nonTieNotes,
                        x: pos.x,
                        rowTopY,
                        direction: pos.arpeggio,
                    });
                }
                // 扫弦箭头
                if (pos.strum) {
                    renderStrumArrow(ctx, {
                        notes: nonTieNotes,
                        x: pos.x,
                        rowTopY,
                        direction: pos.strum,
                    });
                }
            }
        }
    }
}
