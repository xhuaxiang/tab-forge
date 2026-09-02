/**
 * scoreStore.insertNoteAt 单元测试
 *
 * 验证 alphaTab 点击插入音符的行为：
 * 空小节 push、休止替换、和弦合并、单音转和弦、容量校验。
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
