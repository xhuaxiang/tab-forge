/**
 * scoreStore 音符写入单元测试
 *
 * 验证 alphaTab 点击插入与多弦批量写入：
 * 空小节 push、休止替换、和弦合并、单音转和弦、容量校验、原子性。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { scoreStore } from '../../../core/stores/scoreStore.ts';
import type { Measure, Note } from '../../../core/types/index.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[], num = 4, den = 4): Measure {
    return { index: 0, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

beforeEach(() => {
    scoreStore.score.measures = [];
    scoreStore.onChange = null;
    scoreStore._batchDepth = 0;
});

describe('insertNoteAt', () => {
    it('空小节 offset 0 → push（隐式全音符休止占位）', () => {
        scoreStore.score.measures = [measure([])];
        const r = scoreStore.insertNoteAt(0, 0, note({ duration: 0.25 }));
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(1);
        expect(notes[0].fret).toBe(0);
    });

    it('休止拍 → 替换为音符，数量不变', () => {
        scoreStore.score.measures = [measure([
            { isRest: true, duration: 0.25 } as Note,
            note({ duration: 0.25 }),
        ])];
        const r = scoreStore.insertNoteAt(0, 0, note({ duration: 0.25, fret: 3 }));
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(2);
        expect(notes[0].isRest).toBeFalsy();
        expect(notes[0].fret).toBe(3);
    });

    it('和弦 slot → 追加同 chordGroup、时值对齐 slot；同弦重复拒绝', () => {
        scoreStore.score.measures = [measure([
            note({ duration: 0.25, chordGroup: 7, string: 1, fret: 0 }),
            note({ duration: 0.25, chordGroup: 7, string: 2, fret: 2 }),
        ])];
        const r = scoreStore.insertNoteAt(0, 0, note({ duration: 0.5, string: 3, fret: 4 }));
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(3);
        expect(notes[2].chordGroup).toBe(7);
        expect(notes[2].duration).toBe(0.25); // 对齐 slot 时值

        const dup = scoreStore.insertNoteAt(0, 0, note({ duration: 0.25, string: 1, fret: 5 }));
        expect(dup.ok).toBe(false);
        expect(dup.reason).toContain('该弦已有音符');
    });

    it('单音 slot → 合并成共享 chordGroup 的和弦', () => {
        scoreStore.score.measures = [measure([note({ duration: 0.25, string: 1, fret: 0 })])];
        const r = scoreStore.insertNoteAt(0, 0, note({ duration: 0.25, string: 2, fret: 2 }));
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(2);
        expect(notes[0].chordGroup).toBeDefined();
        expect(notes[1].chordGroup).toBe(notes[0].chordGroup);
    });

    it('满小节在尾部新增 → 拒绝「节拍已满」', () => {
        scoreStore.score.measures = [measure([
            note({ duration: 0.25 }), note({ duration: 0.25 }),
            note({ duration: 0.25 }), note({ duration: 0.25 }),
        ])];
        const r = scoreStore.insertNoteAt(0, 4, note({ duration: 0.25 }));
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('节拍已满');
    });

    it('休止替换时新时值超出容量 → 拒绝', () => {
        // 小节：二分休止 + 两个四分 = 满 4/4（1 拍）；把休止换成全音符 1 → 1-0.5+1 > 1
        scoreStore.score.measures = [measure([
            { isRest: true, duration: 0.5 } as Note,
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
        ])];
        const r = scoreStore.insertNoteAt(0, 0, note({ duration: 1 }));
        expect(r.ok).toBe(false);
    });
});

describe('addNotes', () => {
    it('整组一次追加，只触发一次通知', () => {
        scoreStore.score.measures = [measure([])];
        let calls = 0;
        scoreStore.setOnChange(() => { calls++; });

        const r = scoreStore.addNotes([
            note({ duration: 0.25, string: 1, fret: 5, chordGroup: 1 }),
            note({ duration: 0.25, string: 2, fret: 5, chordGroup: 1 }),
            note({ duration: 0.25, string: 3, fret: 5, chordGroup: 1 }),
        ]);

        expect(r.ok).toBe(true);
        expect(scoreStore.score.measures[0].notes).toHaveLength(3);
        expect(calls).toBe(1);
    });

    it('空数组是空操作，不通知、不创建小节', () => {
        let calls = 0;
        scoreStore.setOnChange(() => { calls++; });

        const r = scoreStore.addNotes([]);

        expect(r).toEqual({ ok: false, reason: '没有音符' });
        expect(scoreStore.score.measures).toHaveLength(0);
        expect(calls).toBe(0);
    });

    it('同弦重复 → 拒绝，不写入、不通知', () => {
        let calls = 0;
        scoreStore.setOnChange(() => { calls++; });

        const r = scoreStore.addNotes([
            note({ duration: 0.25, string: 2, fret: 2 }),
            note({ duration: 0.25, string: 2, fret: 5 }),
        ]);

        expect(r).toEqual({ ok: false, reason: '同一根弦出现多次' });
        expect(scoreStore.score.measures).toHaveLength(0);
        expect(calls).toBe(0);
    });
});

describe('insertNotesAt', () => {
    it('空小节尾部插入多弦 → 同一 chordGroup、顺序保留', () => {
        scoreStore.score.measures = [measure([])];
        const r = scoreStore.insertNotesAt(0, 0, [
            note({ duration: 0.25, string: 1, fret: 0 }),
            note({ duration: 0.25, string: 2, fret: 1 }),
            note({ duration: 0.25, string: 6, fret: 3 }),
        ]);
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes.map(n => n.string)).toEqual([1, 2, 6]);
        expect(new Set(notes.map(n => n.chordGroup)).size).toBe(1);
        expect(notes[0].chordGroup).toBeDefined();
    });

    it('休止拍 → 整组替换（数量从 1 个休止变为 3 个音）', () => {
        scoreStore.score.measures = [measure([
            { isRest: true, duration: 0.25 } as Note,
            note({ duration: 0.25, string: 1, fret: 0 }),
        ])];
        const r = scoreStore.insertNotesAt(0, 0, [
            note({ duration: 0.5, string: 2, fret: 2 }),
            note({ duration: 0.5, string: 3, fret: 2 }),
        ]);
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(3); // 组内 2 + 原第二个音
        expect(notes[0].isRest).toBeFalsy();
        expect(notes[0].string).toBe(2);
        expect(notes[1].string).toBe(3);
        // 组内时值统一为第一条（0.5），不与原拍时值混用
        expect(notes[0].duration).toBe(0.5);
        expect(notes[1].duration).toBe(0.5);
        expect(notes[0].chordGroup).toBe(notes[1].chordGroup);
        expect(notes[0].chordGroup).toBeDefined();
    });

    it('单音拍 → 全部合并进同一 chordGroup，时值对齐原拍', () => {
        scoreStore.score.measures = [measure([note({ duration: 0.25, string: 1, fret: 0 })])];
        const r = scoreStore.insertNotesAt(0, 0, [
            note({ duration: 0.5, string: 2, fret: 2 }),
            note({ duration: 0.5, string: 3, fret: 2 }),
        ]);
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(3);
        expect(new Set(notes.map(n => n.chordGroup)).size).toBe(1);
        expect(notes.every(n => n.duration === 0.25)).toBe(true);
    });

    it('合并进已有和弦：复用原 chordGroup，新成员不带组首装饰字段', () => {
        scoreStore.score.measures = [measure([
            note({ duration: 0.25, string: 1, fret: 0, chordGroup: 7, chordName: 'C' }),
            note({ duration: 0.25, string: 2, fret: 1, chordGroup: 7 }),
        ])];
        const r = scoreStore.insertNotesAt(0, 0, [
            note({ duration: 0.25, string: 3, fret: 0, chordName: 'D', arpeggio: 'up' }),
        ]);
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(3);
        expect(notes[2].chordGroup).toBe(7);
        expect(notes[2]).not.toHaveProperty('chordName');
        expect(notes[2]).not.toHaveProperty('arpeggio');
        expect(notes[0].chordName).toBe('C');
    });

    it('原子性：组内任一弦冲突 → 整组不写、不通知', () => {
        scoreStore.score.measures = [measure([note({ duration: 0.25, string: 1, fret: 0 })])];
        let calls = 0;
        scoreStore.setOnChange(() => { calls++; });

        const r = scoreStore.insertNotesAt(0, 0, [
            note({ duration: 0.25, string: 2, fret: 2 }),
            note({ duration: 0.25, string: 1, fret: 5 }),
        ]);

        expect(r.ok).toBe(false);
        expect(r.reason).toContain('该弦已有音符');
        expect(scoreStore.score.measures[0].notes).toHaveLength(1);
        expect(calls).toBe(0);
    });

    it('入参自身重复弦 → 拒绝，不写入', () => {
        scoreStore.score.measures = [measure([])];
        const r = scoreStore.insertNotesAt(0, 0, [
            note({ duration: 0.25, string: 2, fret: 2 }),
            note({ duration: 0.25, string: 2, fret: 5 }),
        ]);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('同一根弦');
        expect(scoreStore.score.measures[0].notes).toHaveLength(0);
    });

    it('尾部插入容量不足 → 拒绝', () => {
        scoreStore.score.measures = [measure([
            note({ duration: 0.25 }), note({ duration: 0.25 }), note({ duration: 0.25 }),
        ])];
        const r = scoreStore.insertNotesAt(0, 4, [
            note({ duration: 0.5, string: 2, fret: 2 }),
            note({ duration: 0.5, string: 3, fret: 2 }),
        ]);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('节拍已满');
    });

    it('单条插入不写 chordGroup（插入线上单音不应变成和弦）', () => {
        scoreStore.score.measures = [measure([])];
        const r = scoreStore.insertNotesAt(0, 0, [
            note({ duration: 0.25, string: 4, fret: 7, chordGroup: 99 }),
        ]);
        expect(r.ok).toBe(true);
        expect(scoreStore.score.measures[0].notes[0].chordGroup).toBeUndefined();
    });

    it('长音内部插入 → 合并进该拍、时值对齐、后续拍仍在其后', () => {
        scoreStore.score.measures = [measure([
            note({ duration: 0.5, string: 1, fret: 0 }),
            note({ duration: 0.25, string: 1, fret: 3 }),
        ])];
        const r = scoreStore.insertNotesAt(0, 0.25, [
            note({ duration: 0.25, string: 2, fret: 2 }),
            note({ duration: 0.25, string: 3, fret: 2 }),
        ]);
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes.map(n => n.string)).toEqual([1, 2, 3, 1]);
        expect(new Set(notes.slice(0, 3).map(n => n.chordGroup)).size).toBe(1);
        expect(notes[0].chordGroup).toBeDefined();
        expect(notes.slice(0, 3).every(n => n.duration === 0.5)).toBe(true);
        expect(notes[3].duration).toBe(0.25);
        expect(notes[3].chordGroup).toBeUndefined();
    });

    it('长休止内部插入 → 整组替换该休止，后续拍保持原位', () => {
        scoreStore.score.measures = [measure([
            { isRest: true, duration: 0.5 } as Note,
            note({ duration: 0.25, string: 1, fret: 3 }),
        ])];
        const r = scoreStore.insertNotesAt(0, 0.25, [
            note({ duration: 0.25, string: 2, fret: 2 }),
            note({ duration: 0.25, string: 3, fret: 2 }),
        ]);
        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(3);
        expect(notes[0].isRest).toBeFalsy();
        expect(notes[0].chordGroup).toBeDefined();
        expect(notes[0].chordGroup).toBe(notes[1].chordGroup);
        expect(notes.slice(0, 2).every(n => n.duration === 0.25)).toBe(true);
        expect(notes[2].string).toBe(1);
        expect(notes[2].fret).toBe(3);
        expect(notes[2].chordGroup).toBeUndefined();
    });

    it('长休止内部替换后容量不足 → 拒绝，原休止保留', () => {
        scoreStore.score.measures = [measure([
            { isRest: true, duration: 0.5 } as Note,
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
        ])];
        const r = scoreStore.insertNotesAt(0, 0.25, [
            note({ duration: 1, string: 2, fret: 2 }),
        ]);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('时值超出小节容量');
        expect(scoreStore.score.measures[0].notes[0].isRest).toBe(true);
    });
});
