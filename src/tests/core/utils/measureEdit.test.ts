/**
 * measureEdit 单元测试
 *
 * 覆盖原位改/删音符的纯函数：locateGroup / applyNoteChange / muteNoteGroup / findNoteAtBeat。
 * 要点：修改保留该拍原时值，和弦内只换单弦且同弦冲突要拦截。
 */

import { describe, it, expect } from 'vitest';
import type { Measure, Note } from '../../../core/types/index.ts';
import {
    locateGroup,
    applyNoteChange,
    muteNoteGroup,
    findNoteAtBeat,
} from '../../../core/utils/measureEdit.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[], num = 4, den = 4): Measure {
    return { index: 0, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

describe('locateGroup', () => {
    it('单音各自为组', () => {
        const m = measure([note({ duration: 0.25 }), note({ duration: 0.25, string: 2 })]);
        const g = locateGroup(m, 0)!;
        expect(g.start).toBe(0);
        expect(g.notes).toHaveLength(1);
    });

    it('同 chordGroup 合并为一组', () => {
        const m = measure([
            note({ duration: 0.25, string: 1, chordGroup: 7 }),
            note({ duration: 0.25, string: 2, chordGroup: 7 }),
            note({ duration: 0.25, string: 3, chordGroup: 7 }),
        ]);
        const g = locateGroup(m, 1)!;
        expect(g.start).toBe(0);
        expect(g.notes).toHaveLength(3);
    });

    it('越界返回 null', () => {
        expect(locateGroup(measure([note({ duration: 0.25 })]), 5)).toBeNull();
    });
});

describe('applyNoteChange', () => {
    it('单音拍整拍替换，并保留原时值', () => {
        const m = measure([note({ duration: 0.5, string: 2, fret: 3 })]);
        const r = applyNoteChange(m, 0, note({ duration: 0.25, string: 3, fret: 5 }));
        expect(r.ok).toBe(true);
        expect(r.notes).toHaveLength(1);
        expect(r.notes![0]).toMatchObject({ string: 3, fret: 5, duration: 0.5 });
        expect(r.notes![0].chordGroup).toBeUndefined();
    });

    it('和弦组内只替换被点的那根弦，其余成员保留', () => {
        const m = measure([
            note({ duration: 0.25, string: 1, fret: 0, chordGroup: 7 }),
            note({ duration: 0.25, string: 2, fret: 3, chordGroup: 7 }),
            note({ duration: 0.25, string: 3, fret: 5, chordGroup: 7 }),
        ]);
        const r = applyNoteChange(m, 1, note({ duration: 0.5, string: 2, fret: 4 }));
        expect(r.ok).toBe(true);
        expect(r.notes!.length).toBe(3);
        expect(r.notes![1]).toMatchObject({ string: 2, fret: 4 });
        // 新成员继承组时值与 chordGroup
        expect(r.notes![1].duration).toBe(0.25);
        expect(r.notes![1].chordGroup).toBe(7);
        // 其他成员原样
        expect(r.notes![0]).toMatchObject({ string: 1, fret: 0 });
        expect(r.notes![2]).toMatchObject({ string: 3, fret: 5 });
    });

    it('和弦内改到其他成员已占的弦 → 拦截', () => {
        const m = measure([
            note({ duration: 0.25, string: 1, fret: 0, chordGroup: 7 }),
            note({ duration: 0.25, string: 2, fret: 3, chordGroup: 7 }),
        ]);
        const r = applyNoteChange(m, 1, note({ duration: 0.25, string: 1, fret: 4 }));
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('该弦');
    });

    it('替换组首成员时保留和弦名称等组装饰字段', () => {
        const m = measure([
            { string: 1, fret: 0, duration: 0.25, chordGroup: 7, chordName: 'Am' } as Note,
            { string: 2, fret: 1, duration: 0.25, chordGroup: 7 } as Note,
            { string: 3, fret: 2, duration: 0.25, chordGroup: 7 } as Note,
        ]);
        const r = applyNoteChange(m, 0, note({ duration: 0.5, string: 1, fret: 5 }));
        expect(r.ok).toBe(true);
        expect(r.notes![0]).toMatchObject({ string: 1, fret: 5, chordName: 'Am', duration: 0.25 });
    });
});

describe('muteNoteGroup', () => {
    it('整拍和弦 → 单个休止符，保留时值', () => {
        const m = measure([
            note({ duration: 0.25, string: 1, fret: 0, chordGroup: 7 }),
            note({ duration: 0.25, string: 2, fret: 3, chordGroup: 7 }),
        ]);
        const r = muteNoteGroup(m, 0)!;
        expect(r.ok).toBe(true);
        expect(r.notes).toHaveLength(1);
        expect(r.notes![0]).toMatchObject({ isRest: true, duration: 0.25 });
    });

    it('已经是休止拍 → 原样返回', () => {
        const m = measure([{ isRest: true, duration: 0.25 } as Note]);
        const r = muteNoteGroup(m, 0)!;
        expect(r.ok).toBe(true);
        expect(r.notes).toEqual(m.notes);
    });
});

describe('findNoteAtBeat', () => {
    it('按拍偏移+弦+品反查下标', () => {
        const m = measure([
            note({ duration: 0.5, string: 1, fret: 0 }),
            note({ duration: 0.5, string: 3, fret: 5 }),
        ]);
        expect(findNoteAtBeat(m, 0.5, 3, 5)).toBe(1);
    });

    it('和弦内命中指定成员', () => {
        const m = measure([
            note({ duration: 0.25, string: 1, fret: 0, chordGroup: 7 }),
            note({ duration: 0.25, string: 2, fret: 3, chordGroup: 7 }),
        ]);
        expect(findNoteAtBeat(m, 0, 2, 3)).toBe(1);
    });

    it('无匹配返回 null', () => {
        const m = measure([note({ duration: 0.25, string: 2, fret: 3 })]);
        expect(findNoteAtBeat(m, 0, 5, 3)).toBeNull();
    });
});
