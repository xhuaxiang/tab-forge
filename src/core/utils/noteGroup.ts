/**
 * noteGroup — 多弦（和弦）录入的纯函数
 *
 * 左侧「多弦音符」与右侧「和弦」共用同一份展开逻辑：把一组 (弦, 品)
 * 展开成共享 `chordGroup` 的多条 Note。分组仍以 `chordGroup` 为准，
 * 同组音符必须在 measure.notes 中**连续**排列（见 measureUtils.forEachSlotGroup）。
 *
 * 单弦（members 长度为 1）不是和弦：调用方不要传 chordGroup（meta 也不会落字段）。
 */

import type { Measure, Note } from '../types/index.ts';

/** 组内成员：弦号 + 品位 */
export interface NoteGroupMember {
    string: number;
    fret: number;
}

/** 组首独占的装饰字段（与 Note 的语义一致：只记在 chordGroup 组第一个音符上） */
export interface NoteGroupMeta {
    chordName?: string;
    arpeggio?: 'up' | 'down';
    strum?: 'up' | 'down';
}

/** 组内所有音符共有的字段（弦/品/分组/组首装饰由 buildNoteGroup 填写） */
export type NoteGroupBase = Omit<
    Note,
    'string' | 'fret' | 'chordGroup' | 'chordName' | 'arpeggio' | 'strum'
>;

/**
 * 取整谱下一个可用的 chordGroup id（现有最大值 + 1）。
 *
 * 不用 Date.now()：id 只要求组内相等、组间不等，递增整数更易读，
 * 也避免同一毫秒内连续分组撞号（AI 导入/批量录入时会遇到）。
 */
export function nextChordGroupId(measures: Measure[]): number {
    let max = 0;
    for (const measure of measures) {
        for (const note of measure.notes) {
            if (note.chordGroup !== undefined && note.chordGroup > max) {
                max = note.chordGroup;
            }
        }
    }
    return max + 1;
}

/**
 * 把一组 (弦, 品) 展开成 Note 数组。
 *
 * @param members    组成员，顺序即写入顺序
 * @param base       所有成员共享的字段（时值/技法/奏法…）
 * @param meta       组首装饰字段（chordName/arpeggio/strum）；
 *                   只有传了 chordGroup（真正的和弦组）时才写到第一条
 * @param chordGroup 分组 id；undefined = 不分组（单弦新增时传 undefined）
 * @returns 新 Note 数组，不修改入参
 */
export function buildNoteGroup(
    members: NoteGroupMember[],
    base: NoteGroupBase,
    meta: NoteGroupMeta = {},
    chordGroup?: number,
): Note[] {
    return members.map((member, index) => {
        const note: Note = { ...base, string: member.string, fret: member.fret };
        if (chordGroup !== undefined) {
            note.chordGroup = chordGroup;
            if (index === 0) {
                if (meta.chordName) note.chordName = meta.chordName;
                if (meta.arpeggio) note.arpeggio = meta.arpeggio;
                if (meta.strum) note.strum = meta.strum;
            }
        }
        return note;
    });
}

/**
 * 校验一组「同一拍位」的音符：非空、弦号齐全、同弦不重复。
 *
 * @returns 错误描述；合法返回 null
 */
export function validateNoteGroup(notes: Note[]): string | null {
    if (notes.length === 0) return '没有音符';
    if (notes.some(n => n.string === undefined)) return '音符缺少弦号';
    const strings = notes.map(n => n.string);
    if (new Set(strings).size !== strings.length) return '同一根弦出现多次';
    return null;
}
