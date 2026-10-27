/**
 * noteGroup 单元测试
 *
 * 覆盖多弦录入共用的纯函数：
 * - nextChordGroupId：全局最大 id + 1
 * - buildNoteGroup：组内共享字段、组首独占装饰字段、单弦不分组
 * - validateNoteGroup：非空/弦号齐全/同弦不重复
 */

import { describe, it, expect } from 'vitest';
import { nextChordGroupId, buildNoteGroup, validateNoteGroup } from '../../../core/utils/noteGroup.ts';
import type { Measure, Note } from '../../../core/types/index.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[]): Measure {
    return { index: 0, notes, timeSignatureNumerator: 4, timeSignatureDenominator: 4 };
}

const base = (partial: Partial<Note> = {}) => ({ duration: 0.25 as const, ...partial });

describe('nextChordGroupId', () => {
    it('空谱 → 1', () => {
        expect(nextChordGroupId([])).toBe(1);
    });

    it('没有 chordGroup 的音符（单音/休止）不参与计算', () => {
        expect(nextChordGroupId([measure([
            note({ duration: 0.25 }),
            { isRest: true, duration: 0.5 } as Note,
        ])])).toBe(1);
    });

    it('跨小节取全局最大值 + 1', () => {
        const measures = [
            measure([note({ duration: 0.25, chordGroup: 3 })]),
            measure([note({ duration: 0.25, chordGroup: 7 })]),
            measure([note({ duration: 0.25 })]),
        ];
        expect(nextChordGroupId(measures)).toBe(8);
    });

    it('id 不要求连续：只有 100 时返回 101', () => {
        expect(nextChordGroupId([measure([note({ duration: 1, chordGroup: 100 })])])).toBe(101);
    });
});

describe('buildNoteGroup', () => {
    it('单弦且未传 chordGroup → 不带分组字段', () => {
        const notes = buildNoteGroup([{ string: 3, fret: 5 }], base());
        expect(notes).toHaveLength(1);
        expect(notes[0]).toEqual({ string: 3, fret: 5, duration: 0.25 });
        expect(notes[0].chordGroup).toBeUndefined();
    });

    it('多弦 → 全部共享传入的 chordGroup', () => {
        const notes = buildNoteGroup(
            [{ string: 1, fret: 0 }, { string: 2, fret: 1 }, { string: 6, fret: 3 }],
            base(),
            {},
            42,
        );
        expect(notes.map(n => n.chordGroup)).toEqual([42, 42, 42]);
    });

    it('组成员顺序 = 写入顺序', () => {
        const notes = buildNoteGroup(
            [{ string: 6, fret: 3 }, { string: 2, fret: 1 }, { string: 1, fret: 0 }],
            base(),
            {},
            1,
        );
        expect(notes.map(n => n.string)).toEqual([6, 2, 1]);
    });

    it('base 字段复制到每个成员，且不修改入参', () => {
        const shared = base({ palmMute: true, technique: 'bend', bendAmount: 0.5 });
        const notes = buildNoteGroup([{ string: 1, fret: 2 }, { string: 2, fret: 2 }], shared, {}, 1);
        for (const n of notes) {
            expect(n.duration).toBe(0.25);
            expect(n.palmMute).toBe(true);
            expect(n.technique).toBe('bend');
            expect(n.bendAmount).toBe(0.5);
        }
        expect(shared).not.toHaveProperty('string');
        expect(shared).not.toHaveProperty('chordGroup');
    });

    it('chordName / arpeggio / strum 只写到组首', () => {
        const notes = buildNoteGroup(
            [{ string: 1, fret: 0 }, { string: 2, fret: 1 }],
            base(),
            { chordName: 'Am', arpeggio: 'up', strum: 'down' },
            5,
        );
        expect(notes[0]).toMatchObject({ chordName: 'Am', arpeggio: 'up', strum: 'down' });
        expect(notes[1]).not.toHaveProperty('chordName');
        expect(notes[1]).not.toHaveProperty('arpeggio');
        expect(notes[1]).not.toHaveProperty('strum');
    });

    it('meta 里的空字符串/undefined 不落字段（避免空 chordName）', () => {
        const notes = buildNoteGroup(
            [{ string: 1, fret: 0 }, { string: 2, fret: 1 }],
            base(),
            { chordName: '', arpeggio: undefined },
            1,
        );
        expect(notes[0]).not.toHaveProperty('chordName');
        expect(notes[0]).not.toHaveProperty('arpeggio');
    });

    it('没有 chordGroup 时连组首装饰字段也不写（单音不是和弦组）', () => {
        const notes = buildNoteGroup(
            [{ string: 3, fret: 5 }],
            base(),
            { chordName: 'C', arpeggio: 'up', strum: 'down' },
            undefined,
        );
        expect(notes[0].chordGroup).toBeUndefined();
        expect(notes[0]).not.toHaveProperty('chordName');
        expect(notes[0]).not.toHaveProperty('arpeggio');
        expect(notes[0]).not.toHaveProperty('strum');
    });

    it('空成员列表 → 空数组', () => {
        expect(buildNoteGroup([], base(), {}, 1)).toEqual([]);
    });
});

describe('validateNoteGroup', () => {
    it('合法组 → null', () => {
        expect(validateNoteGroup([
            note({ duration: 0.25, string: 1 }),
            note({ duration: 0.25, string: 2 }),
        ])).toBeNull();
    });

    it('空数组 → 报错', () => {
        expect(validateNoteGroup([])).toBe('没有音符');
    });

    it('缺少弦号 → 报错', () => {
        expect(validateNoteGroup([note({ duration: 0.25, string: undefined })])).toBe('音符缺少弦号');
    });

    it('同弦重复 → 报错', () => {
        expect(validateNoteGroup([
            note({ duration: 0.25, string: 2 }),
            note({ duration: 0.25, string: 2 }),
        ])).toBe('同一根弦出现多次');
    });
});
