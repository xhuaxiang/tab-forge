/**
 * measureEdit — 小节内容原位编辑的纯函数（无副作用，可单测）
 *
 * 供 scoreStore 的「改动选中小节」动作使用：
 * - locateGroup     定位某音符下标所在的拍位组（单音/休止符长度为 1，和弦为连续同 chordGroup 的一组）
 * - applyNoteChange 原位修改组内音符（单音拍 → 整拍替换；和弦 → 只换被点的那根弦）
 * - muteNoteGroup   把整拍（含和弦）静音为休止符，保留该拍时值
 * - findNoteAtBeat  按「拍偏移 + 弦 + 品」反查音符在 measure.notes 里的下标
 *
 * 设计约束：改拍一律**保留该拍原有时值**，避免改变小节内节奏排布/触发后移重排
 * （变时值、后移、undo 等留待后续阶段）。
 */

import type { Measure, Note } from '../types/index.ts';
import { forEachSlotGroup } from './measureUtils.ts';

/** 拍位组信息：组成员在 measure.notes 中的起始下标 + 组成员 */
export interface GroupInfo {
    start: number;
    notes: Note[];
}

/** 编辑结果：ok=false 时带 reason，ok=true 时 notes 为替换后的完整 notes 数组 */
export interface EditResult {
    ok: boolean;
    reason?: string;
    notes?: Note[];
}

/** 返回 noteIndex 所在拍位组（找不到返回 null） */
export function locateGroup(measure: Measure, noteIndex: number): GroupInfo | null {
    if (noteIndex < 0 || noteIndex >= measure.notes.length) return null;
    let found: GroupInfo | null = null;
    forEachSlotGroup(measure, (start, notes) => {
        if (found !== null || noteIndex < start || noteIndex >= start + notes.length) return;
        found = { start, notes };
    });
    return found;
}

/**
 * 原位修改音符。
 * - 目标在单音/休止拍 → 整拍替换为 note（保留该拍原时值，清除 chordGroup）
 * - 目标在和弦组内 → 只替换被点的那根弦（保留组时值/chordGroup；新弦号与组内其他弦冲突则报错）
 */
export function applyNoteChange(measure: Measure, noteIndex: number, note: Note): EditResult {
    const g = locateGroup(measure, noteIndex);
    if (!g) return { ok: false, reason: '目标音符不存在' };
    const notes = measure.notes;

    if (g.notes.length === 1) {
        const slotDur = g.notes[0].duration;
        const replaced: Note = { ...note, duration: slotDur, chordGroup: undefined };
        return { ok: true, notes: notes.slice(0, g.start).concat([replaced], notes.slice(g.start + 1)) };
    }

    // 和弦组：仅替换成员（保留组装饰字段 chordName/arpeggio/strum，它们在组首音符上）
    const memberIdx = noteIndex - g.start;
    const oldMember = g.notes[memberIdx];
    const newString = note.string;
    const conflict = g.notes.some((n, idx) => idx !== memberIdx && n.string !== undefined && n.string === newString);
    if (conflict) return { ok: false, reason: '和弦内该弦已有音符' };

    const member: Note = {
        ...oldMember,
        ...note,
        duration: g.notes[0].duration,
        chordGroup: g.notes[0].chordGroup,
    };
    const out = notes.slice();
    out[noteIndex] = member;
    return { ok: true, notes: out };
}

/** 把整拍（单音或和弦）静音为休止符，保留该拍时值；本身就是休止拍则原样返回 */
export function muteNoteGroup(measure: Measure, noteIndex: number): EditResult {
    const g = locateGroup(measure, noteIndex);
    if (!g) return { ok: false, reason: '目标音符不存在' };
    const notes = measure.notes;
    if (g.notes.length === 1 && g.notes[0].isRest) return { ok: true, notes: notes.slice() };

    const rest: Note = { isRest: true, duration: g.notes[0].duration };
    return { ok: true, notes: notes.slice(0, g.start).concat([rest], notes.slice(g.start + g.notes.length)) };
}

/**
 * 按「拍偏移(全音符=1，从小节起点算) + 弦号 + 品」反查音符下标。
 * 命中该拍位组内同弦同品的成员；找不到返回 null。
 */
export function findNoteAtBeat(
    measure: Measure,
    beatOffset: number,
    stringNum: number,
    fret: number,
): number | null {
    let result: number | null = null;
    let acc = 0;
    let inSlot = false;
    forEachSlotGroup(measure, (start, notes) => {
        if (inSlot) return;
        const end = acc + notes[0].duration;
        if (beatOffset >= acc - 1e-6 && beatOffset < end - 1e-6) {
            inSlot = true;
            for (let k = 0; k < notes.length; k++) {
                const n = notes[k];
                if (n.isRest || n.string === undefined) continue;
                if (n.string === stringNum && n.fret === fret) {
                    result = start + k;
                    return;
                }
            }
            result = null;
            return;
        }
        acc = end;
    });
    return result;
}
