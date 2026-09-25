/**
 * measureUtils 单元测试
 *
 * forEachSlot 是播放调度与渲染共用的拍位分组逻辑，
 * 单独验证其分组/时值统计行为。
 */

import { describe, it, expect } from 'vitest';
import type { Measure, Note } from '../../../core/types/index.ts';
import { forEachSlot, measureTotalBeats, canAddToMeasure, locateSlotAt } from '../../../core/utils/measureUtils.ts';
import {
    measureToSlotCount,
    buildSlotEntries,
    forEachSlotGroup,
    createEmptyMeasure,
} from '../../../core/utils/measureUtils.ts';

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

/** 生成 count 个四分音符（单音，各自成组） */
function quarters(count: number): Note[] {
    return Array.from({ length: count }, () => note({ duration: 0.25 }));
}

describe('measureToSlotCount', () => {
    it('空小节计 0 个拍位', () => {
        expect(measureToSlotCount(measure([]), 0.25)).toBe(0);
    });

    it('单音各自成组，按 duration / beatUnit 折算后累加', () => {
        const m = measure([
            note({ duration: 0.5 }),
            note({ duration: 0.25 }),
            note({ duration: 0.125 }),
        ]);
        expect(measureToSlotCount(m, 0.125)).toBe(4 + 2 + 1);
    });

    it('同 chordGroup 合并后只计组首一次时值', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
            note({ duration: 0.25, chordGroup: 1, string: 3 }),
        ]);
        expect(measureToSlotCount(m, 0.25)).toBe(1);
    });

    it('休止符与单音一样按时值计入', () => {
        const m = measure([note({ duration: 0.25, isRest: true }), note({ duration: 0.25 })]);
        expect(measureToSlotCount(m, 0.25)).toBe(2);
    });

    it('4/4 恰好占满 4 拍 → 4 个拍位', () => {
        expect(measureToSlotCount(measure(quarters(4)), 0.25)).toBe(4);
    });

    it('超出拍号容量不做截断，按实际内容求和', () => {
        expect(measureToSlotCount(measure(quarters(5)), 0.25)).toBe(5);
    });

    it('beatUnit = 1（全音符）时四分音符折算为 0 个拍位', () => {
        const m = measure([note({ duration: 1 }), note({ duration: 0.25 })]);
        expect(measureToSlotCount(m, 1)).toBe(1);
    });

    it('duration 恰为 beatUnit 一半时按 Math.round 进位为 1', () => {
        expect(measureToSlotCount(measure([note({ duration: 0.25 })]), 0.5)).toBe(1);
    });

    it('结果只取决于内容，与拍号无关（3/4 同样按内容累加）', () => {
        expect(measureToSlotCount(measure(quarters(3), 3, 4), 0.25)).toBe(3);
    });
});

describe('buildSlotEntries', () => {
    it('空小节返回空数组', () => {
        expect(buildSlotEntries(measure([]))).toEqual([]);
    });

    it('单音条目只含 notes / duration / isRest 三个字段', () => {
        const n = note({ duration: 0.25, string: 3, fret: 5 });
        const entries = buildSlotEntries(measure([n]));
        expect(entries).toHaveLength(1);
        expect(Object.keys(entries[0]).sort()).toEqual(['duration', 'isRest', 'notes']);
        expect(entries[0].duration).toBe(0.25);
        expect(entries[0].isRest).toBeUndefined();
        expect(entries[0].notes).toHaveLength(1);
        expect(entries[0].notes[0]).toBe(n);
    });

    it('休止符条目的 isRest 为 true，duration 取休止时值', () => {
        const entries = buildSlotEntries(measure([note({ duration: 0.5, isRest: true })]));
        expect(entries).toHaveLength(1);
        expect(entries[0].isRest).toBe(true);
        expect(entries[0].duration).toBe(0.5);
    });

    it('和弦条目带 arpeggio / strum 字段，duration 取组首，不含 isRest 字段', () => {
        const a = note({ duration: 0.25, chordGroup: 1, arpeggio: 'up', strum: 'down' });
        const b = note({ duration: 0.25, chordGroup: 1, string: 2, fret: 1 });
        const entries = buildSlotEntries(measure([a, b]));
        expect(entries).toHaveLength(1);
        expect(Object.keys(entries[0]).sort()).toEqual(['arpeggio', 'duration', 'notes', 'strum']);
        expect(entries[0].notes).toEqual([a, b]);
        expect(entries[0].notes).toHaveLength(2);
        expect(entries[0].duration).toBe(0.25);
        expect(entries[0].arpeggio).toBe('up');
        expect(entries[0].strum).toBe('down');
        expect('isRest' in entries[0]).toBe(false);
    });

    it('条目顺序与 forEachSlot 分组一致，notes 为切片且元素引用不变', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
            note({ duration: 0.5 }),
            note({ duration: 0.25, isRest: true }),
        ]);
        const slotSizes: number[] = [];
        forEachSlot(m, g => slotSizes.push(g.length));
        expect(slotSizes).toEqual([2, 1, 1]);

        const entries = buildSlotEntries(m);
        expect(entries.map(e => e.notes.length)).toEqual(slotSizes);
        expect(entries.map(e => e.duration)).toEqual([0.25, 0.5, 0.25]);
        // 各组首音对应原 notes 的下标 0 / 2 / 3，且为同一对象引用（仅数组是切片）
        expect(entries[0].notes[0]).toBe(m.notes[0]);
        expect(entries[1].notes[0]).toBe(m.notes[2]);
        expect(entries[2].notes[0]).toBe(m.notes[3]);
        expect(entries[0].notes).not.toBe(m.notes);
    });
});

describe('createEmptyMeasure', () => {
    it('返回 index 透传、notes 为空、拍号默认 4/4 的小节', () => {
        expect(createEmptyMeasure(7)).toStrictEqual({
            index: 7,
            notes: [],
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        });
    });

    it('每次调用返回独立对象与独立 notes 数组', () => {
        const a = createEmptyMeasure(0);
        const b = createEmptyMeasure(0);
        expect(a).not.toBe(b);
        expect(a.notes).not.toBe(b.notes);
        a.notes.push(note({ duration: 0.25 }));
        expect(a.notes).toHaveLength(1);
        expect(b.notes).toHaveLength(0);
    });
});

describe('forEachSlotGroup', () => {
    it('空小节不触发任何回调', () => {
        let calls = 0;
        forEachSlotGroup(measure([]), () => { calls++; });
        expect(calls).toBe(0);
    });

    it('回调参数为 (组首下标, 组成员)，单音也成组', () => {
        const m = measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25, chordGroup: 9 }),
            note({ duration: 0.25, chordGroup: 9, string: 2 }),
            note({ duration: 0.5 }),
        ]);
        const starts: number[] = [];
        const sizes: number[] = [];
        forEachSlotGroup(m, (start, notes) => { starts.push(start); sizes.push(notes.length); });
        expect(starts).toEqual([0, 1, 3]);
        expect(sizes).toEqual([1, 2, 1]);
    });

    it('全单音小节的 start 依次为 0,1,2', () => {
        const seen: Array<[number, number]> = [];
        forEachSlotGroup(measure(quarters(3)), (start, notes) => seen.push([start, notes.length]));
        expect(seen).toEqual([[0, 1], [1, 1], [2, 1]]);
    });

    it('组首无 chordGroup 时，紧随其后的同 chordGroup 音符不被并入', () => {
        const m = measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25, chordGroup: 3 }),
            note({ duration: 0.25, chordGroup: 3, string: 2 }),
        ]);
        const sizes: number[] = [];
        forEachSlotGroup(m, (_start, notes) => sizes.push(notes.length));
        expect(sizes).toEqual([1, 2]);
    });

    it('同 chordGroup 但不相邻时不合并（只合并连续同组）', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 2 }),
            note({ duration: 0.25, chordGroup: 1 }),
        ]);
        const starts: number[] = [];
        const sizes: number[] = [];
        forEachSlotGroup(m, (start, notes) => { starts.push(start); sizes.push(notes.length); });
        expect(starts).toEqual([0, 1, 2]);
        expect(sizes).toEqual([1, 1, 1]);
    });

    it('与 forEachSlot 分组结果完全一致，仅多出 start 参数', () => {
        const m = measure([
            note({ duration: 0.5, chordGroup: 4 }),
            note({ duration: 0.5, chordGroup: 4, string: 2 }),
            note({ duration: 0.25, isRest: true }),
            note({ duration: 0.25 }),
        ]);
        const viaSlot: Note[][] = [];
        forEachSlot(m, g => viaSlot.push(g));
        const viaGroup: Array<{ start: number; notes: Note[] }> = [];
        forEachSlotGroup(m, (start, notes) => viaGroup.push({ start, notes }));
        expect(viaGroup.map(g => g.notes)).toEqual(viaSlot);
        expect(viaGroup.map(g => g.start)).toEqual([0, 2, 3]);
    });

    it('回调返回值被忽略且返回 void，无提前中止语义', () => {
        const starts: number[] = [];
        const result = forEachSlotGroup(measure(quarters(3)), (start) => {
            starts.push(start);
            return false as unknown as void;
        });
        expect(result).toBeUndefined();
        expect(starts).toEqual([0, 1, 2]);
    });
});
