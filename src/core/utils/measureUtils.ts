/**
 * measureUtils — 小节工具函数
 *
 * 统一处理按 chordGroup 合并遍历 measure.notes 的逻辑。
 * 避免多处重复实现相同的有状态遍历。
 */

import type { Measure, Note } from '../types/index.ts';

/**
 * 返回从 `start` 开始的拍位组结束下标（不含）。
 *
 * 分组规则只在这里实现：单音/休止符各自成组；只有组首带 `chordGroup`
 * 时，才把紧随其后、`chordGroup` 相同的音符并进来。只合并相邻项。
 */
function slotEndIndex(notes: readonly Note[], start: number): number {
    const first = notes[start];
    let end = start + 1;
    if (first.chordGroup !== undefined) {
        while (end < notes.length && notes[end].chordGroup === first.chordGroup) end++;
    }
    return end;
}

/**
 * 把拍平音符按 chordGroup 分组成拍位。
 *
 * 与 `forEachSlotGroup` 共用 `slotEndIndex`，是拍位分组规则的唯一实现。
 * 只合并相邻项，返回的组内元素与原数组是同一批引用（只复制了组数组）。
 */
export function groupNotes(notes: readonly Note[]): Note[][] {
    const groups: Note[][] = [];
    let start = 0;
    while (start < notes.length) {
        const end = slotEndIndex(notes, start);
        groups.push(notes.slice(start, end));
        start = end;
    }
    return groups;
}

/**
 * 按拍位分组遍历 measure.notes（单一来源）
 *
 * 单音/休止符各自独立为一组（`notes.length === 1`），
 * 和弦内连续同 chordGroup 的音符合并为一组。
 *
 * 与 forEachSlot 相同，但额外提供每组在 measure.notes 里的起始下标，
 * 供「按下标定位拍位组」的编辑逻辑复用（见 measureEdit）。
 *
 * @param callback 每组回调：(start=组首下标, notes=组成员)
 */
export function forEachSlotGroup(
    measure: Measure,
    callback: (start: number, notes: Note[]) => void,
): void {
    const notes = measure.notes;
    let i = 0;
    while (i < notes.length) {
        const end = slotEndIndex(notes, i);
        callback(i, notes.slice(i, end));
        i = end;
    }
}

/**
 * 按拍位分组遍历 measure.notes
 *
 * @param callback 每组回调，参数为当前拍位的所有音符（单音则长度为1）
 */
export function forEachSlot(
    measure: Measure,
    callback: (notes: Note[]) => void,
): void {
    forEachSlotGroup(measure, (_start, notes) => callback(notes));
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
 * 每个拍位组的起始拍偏移（全音符 = 1）。
 *
 * 复用 `forEachSlotGroup` 的分组规则，下标与 `groupNotes` / alphaTab beat 顺序一致。
 * 空小节返回空数组。
 */
export function slotStartOffsets(measure: Measure): number[] {
    const starts: number[] = [];
    let acc = 0;
    forEachSlotGroup(measure, (_start, notes) => {
        starts.push(acc);
        acc += notes[0].duration;
    });
    return starts;
}

/**
 * 光标拍位读数（HUD 用）。
 *
 * - 空小节（没有任何 slot）→ `空小节`
 * - 拍偏移等于/接近内容总拍数（含非有限值）→ `小节尾`
 * - 落在某个 slot 起点或内部 → `拍位 N`（N 为 slot 序号，1 起）
 *
 * 用「拍位」而非「第 N 拍」：时值不均时 slot 序号不等于传统拍号语义，
 * 这里表达的是「第 N 个拍位」。
 */
export function cursorBeatLabel(measure: Measure, beatOffset: number): string {
    const EPS = 1e-6;
    const starts = slotStartOffsets(measure);
    if (starts.length === 0) return '空小节';

    const total = measureTotalBeats(measure);
    // 非有限偏移无法落位，统一按小节尾处理（保证读数确定）
    if (!Number.isFinite(beatOffset)) return '小节尾';
    if (beatOffset >= total - EPS) return '小节尾';

    let index = -1;
    for (let i = 0; i < starts.length; i++) {
        if (Math.abs(starts[i] - beatOffset) < EPS) {
            index = i;
            break;
        }
        if (starts[i] <= beatOffset + EPS) index = i;
    }
    if (index < 0) index = 0;
    return `拍位 ${index + 1}`;
}

/**
 * alphaTab beat 下标 → 应用拍偏移（全音符 = 1）。
 *
 * - null（小节尾）→ 该小节内容总拍数 `measureTotalBeats`
 * - 空小节的下标 0 → 0（alphaTab 用全音符休止渲染空小节，与应用 slot 0 对应）
 * - 合法下标 → 对应 slot 起点
 * - 其余（负数 / 越界 / 非整数）→ null，调用方不应据此设光标
 */
export function beatIndexToOffset(measure: Measure, beatIndex: number | null): number | null {
    if (beatIndex === null) return measureTotalBeats(measure);

    const starts = slotStartOffsets(measure);
    if (starts.length === 0) return beatIndex === 0 ? 0 : null;
    if (!Number.isInteger(beatIndex) || beatIndex < 0 || beatIndex >= starts.length) return null;
    return starts[beatIndex];
}

/** 小节容量（以全音符为 1 的拍数），如 4/4 → 1、6/8 → 0.75 */
export function measureCapacity(measure: Measure): number {
    return measure.timeSignatureNumerator / measure.timeSignatureDenominator;
}

/**
 * 拍号字符串 → 小节容量（以全音符为 1 的拍数）。
 *
 * 与 `measureCapacity` 共用同一份公式；生成器在还没有 `Measure` 时用它。
 */
export function capacityFromTimeSignature(signature: string): number {
    const { numerator, denominator } = parseTimeSignature(signature);
    return numerator / denominator;
}


/**
 * 检查能否在小节内添加指定时值
 */
export function canAddToMeasure(measure: Measure, duration: number): boolean {
    return measureTotalBeats(measure) + duration <= measureCapacity(measure) + 0.001;
}

/**
 * 定位某个拍偏移（拍数，全音符=1）落在哪个 slot。
 *
 * 与 forEachSlot 相同的遍历逻辑，但返回 slot 在 measure.notes 里的原始边界，
 * 供按位置插入/替换音符时 splice 使用。
 * - `'slot'`：拍偏移正好落在某 slot 起始处
 * - `'inside'`：拍偏移落在某 slot 内部（该 slot 跨多个拍）
 * - `'end'`：超出所有内容（空小节隐式全音符休止 / 尾部）
 */
export type SlotLocation =
    | { kind: 'slot'; index: number; slot: Note[]; start: number }
    | { kind: 'inside'; afterIndex: number; slot: Note[]; start: number }
    | { kind: 'end'; index: number };

export function locateSlotAt(measure: Measure, beatOffset: number): SlotLocation {
    const notes = measure.notes;
    let acc = 0;
    let i = 0;
    while (i < notes.length) {
        const endIndex = slotEndIndex(notes, i);
        const start = acc;
        const end = acc + notes[i].duration;
        if (Math.abs(beatOffset - start) < 1e-6) {
            return { kind: 'slot', index: i, slot: notes.slice(i, endIndex), start };
        }
        if (beatOffset > start && beatOffset < end) {
            return { kind: 'inside', afterIndex: endIndex, slot: notes.slice(i, endIndex), start };
        }
        acc = end;
        i = endIndex;
    }
    return { kind: 'end', index: notes.length };
}

/**
 * 解析拍号字符串（如 `'4/4'`、`'6/8'`）→ 分子/分母。
 *
 * 拍号在数据里是「全局字符串 + 每小节两个数字」两种形态，这是两者之间
 * 唯一的换算处（此前在 scoreStore 里内联了三遍）。
 */
export function parseTimeSignature(sig: string): { numerator: number; denominator: number } {
    const [numerator, denominator] = sig.split('/').map(Number);
    return { numerator, denominator };
}

/**
 * 创建空白小节。
 *
 * @param timeSignature 拍号字符串；省略时用 4/4。传了就用它填每小节的分子/分母
 *                      （小节的拍号字段必须与全局拍号一致，别再手写 4/4）。
 */
export function createEmptyMeasure(index: number, timeSignature: string = '4/4'): Measure {
    const { numerator, denominator } = parseTimeSignature(timeSignature);
    return {
        index,
        notes: [],
        timeSignatureNumerator: numerator,
        timeSignatureDenominator: denominator,
    };
}
