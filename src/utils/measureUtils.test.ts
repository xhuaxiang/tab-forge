/**
 * measureUtils 单元测试
 *
 * forEachSlot 是播放调度与渲染共用的拍位分组逻辑，
 * 单独验证其分组/时值统计行为。
 */

import { describe, it, expect } from 'vitest';
import type { Measure, Note } from '../types/index.ts';
import { forEachSlot, measureTotalBeats, canAddToMeasure } from './measureUtils.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[], num = 4, den = 4): Measure {
    return { index: 0, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

describe('forEachSlot', () => {
    it('单音各自成组', () => {
        const groups: Note[][] = [];
        forEachSlot(measure([note({ duration: 0.25 }), note({ duration: 0.25 })]), g => groups.push(g));
        expect(groups).toHaveLength(2);
        expect(groups[0]).toHaveLength(1);
    });

    it('同 chordGroup 合并，不同分组分开', () => {
        const groups: Note[][] = [];
        const m = measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25, chordGroup: 5 }),
        ]);
        forEachSlot(m, g => groups.push(g));
        expect(groups.map(g => g.length)).toEqual([2, 1, 1]);
    });
});

describe('measureTotalBeats', () => {
    it('和弦组只计一次时值', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
        ]);
        expect(measureTotalBeats(m)).toBeCloseTo(0.25, 5);
    });
});

describe('canAddToMeasure', () => {
    it('4/4 内允许再放一个四分音符', () => {
        expect(canAddToMeasure(measure([note({ duration: 0.25 })]), 0.25)).toBe(true);
    });

    it('已满 4 拍时拒绝再加四分音符', () => {
        const m = measure([
            note({ duration: 0.25 }), note({ duration: 0.25 }),
            note({ duration: 0.25 }), note({ duration: 0.25 }),
        ]);
        expect(canAddToMeasure(m, 0.25)).toBe(false);
    });
});
