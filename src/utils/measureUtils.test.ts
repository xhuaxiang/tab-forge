/**
 * measureUtils 单元测试
 *
 * forEachSlot 是播放调度与渲染共用的拍位分组逻辑，
 * 单独验证其分组/时值统计行为。
 */

import { describe, it, expect } from 'vitest';
import type { Measure, Note } from '../types/index.ts';
import { forEachSlot, measureTotalBeats, canAddToMeasure, locateSlotAt } from './measureUtils.ts';

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

describe('locateSlotAt', () => {
    it('拍偏移正好落在 slot 起始 → slot 边界', () => {
        const m = measure([note({ duration: 0.25 }), note({ duration: 0.25 })]);
        const loc = locateSlotAt(m, 0.25);
        expect(loc.kind).toBe('slot');
        if (loc.kind === 'slot') {
            expect(loc.index).toBe(1);
            expect(loc.slot).toHaveLength(1);
            expect(loc.start).toBeCloseTo(0.25, 5);
        }
    });

    it('拍偏移落在跨拍 slot 内部 → inside', () => {
        const m = measure([note({ duration: 0.5 }), note({ duration: 0.25 })]);
        const loc = locateSlotAt(m, 0.25);
        expect(loc.kind).toBe('inside');
        if (loc.kind === 'inside') {
            expect(loc.afterIndex).toBe(1);
            expect(loc.slot).toHaveLength(1);
        }
    });

    it('和弦 slot 整体返回', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
        ]);
        const loc = locateSlotAt(m, 0);
        expect(loc.kind).toBe('slot');
        if (loc.kind === 'slot') {
            expect(loc.slot).toHaveLength(2);
        }
    });

    it('超出所有内容 → end', () => {
        const m = measure([note({ duration: 0.25 })]);
        expect(locateSlotAt(m, 1).kind).toBe('end');
    });

    it('浮点累计误差下仍命中边界', () => {
        // 0.125+0.125+0.25 累计不应因浮点导致错位
        const m = measure([
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
            note({ duration: 0.25 }),
        ]);
        const loc = locateSlotAt(m, 0.125 + 0.125);
        expect(loc.kind).toBe('slot');
        if (loc.kind === 'slot') expect(loc.index).toBe(2);
    });
});
