/**
 * measureUtils — 小节工具函数
 *
 * 统一处理按 chordGroup 合并遍历 measure.notes 的逻辑。
 * 避免多处重复实现相同的有状态遍历。
 */

import type { Measure, Note } from '../types/index.ts';

/**
 * 按拍位分组遍历 measure.notes
 *
 * 单音/休止符各自独立为一组（`notes.length === 1`），
 * 和弦内同 chordGroup 的音符合并为一组（`notes.length > 1`）。
 *
 * @param callback 每组回调，参数为当前拍位的所有音符（单音则长度为1）
 */
export function forEachSlot(
    measure: Measure,
    callback: (notes: Note[]) => void,
): void {
    let group: Note[] = [];
    let lastGroupId: number | undefined;

    function flush() {
        if (group.length > 0) {
            callback(group);
            group = [];
        }
    }

    for (const note of measure.notes) {
        if (note.chordGroup !== undefined) {
            if (note.chordGroup !== lastGroupId) {
                flush();
                lastGroupId = note.chordGroup;
            }
            group.push(note);
        } else {
            flush();
            lastGroupId = undefined;
            callback([note]);
        }
    }
    flush();
}

/**
 * 计算小节的总拍数（和弦组只计一次 duration）
 */
export function measureTotalBeats(measure: Measure): number {
    let total = 0;
    forEachSlot(measure, (notes) => {
        total += notes[0].duration;
    });
    return total;
}

/**
 * 检查能否在小节内添加指定时值
 */
export function canAddToMeasure(measure: Measure, duration: number): boolean {
    const cap = measure.timeSignatureNumerator * (1 / measure.timeSignatureDenominator);
    return measureTotalBeats(measure) + duration <= cap + 0.001;
}

/**
 * 计算小节展开后的拍位数量
 */
export function measureToSlotCount(measure: Measure, beatUnit: number): number {
    let totalSlots = 0;
    forEachSlot(measure, (notes) => {
        totalSlots += Math.round(notes[0].duration / beatUnit);
    });
    return totalSlots;
}

/**
 * 构建拍位条目列表（SlotEntry[]）
 * 用于 layout.ts 的布局计算
 */
export function buildSlotEntries(measure: Measure): import('../types/canvas.ts').SlotEntry[] {
    const entries: import('../types/canvas.ts').SlotEntry[] = [];
    forEachSlot(measure, (notes) => {
        if (notes.length === 1) {
            entries.push({
                notes,
                duration: notes[0].duration,
                isRest: notes[0].isRest,
            });
        } else {
            entries.push({
                notes,
                duration: notes[0].duration,
                arpeggio: notes[0].arpeggio,
                strum: notes[0].strum,
            });
        }
    });
    return entries;
}
