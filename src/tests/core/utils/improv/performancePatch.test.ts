/**
 * performancePatch — 拍位索引、序列化与 AI 表现补丁应用。
 *
 * 底稿由真实本地生成器按固定 seed 产出；补丁定位一律经序列化结果换算，
 * 避免在断言里手写拍位下标。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type { Note } from '../../../../core/types/index.ts';
import type {
    PerformancePatch,
    PerformanceSlot,
    ResolvedImprovOptions,
} from '../../../../core/types/improv/index.ts';
import { groupFlatNotes } from '../../../../core/utils/noteGroup.ts';
import { generateLocalImprovisation } from '../../../../core/utils/improv/generate.ts';
import {
    applyPerformancePatches,
    indexImprovSlots,
    serializeImprovSlots,
} from '../../../../core/utils/improv/performancePatch.ts';
import type { SerializedImprovSlot } from '../../../../core/utils/improv/performancePatch.ts';
import { makeOptions } from './testOptions.ts';

const PLAYABILITY = LOCAL_IMPROV_CONFIG.playability;

type LocalResult = ReturnType<typeof generateLocalImprovisation>;

function generate(seed: number): LocalResult {
    return generateLocalImprovisation({
        key: 'C',
        scaleType: 'Major (Ionian)',
        style: 'Folk',
        density: '中',
        numMeasures: 2,
        timeSignature: '4/4',
        seed,
    });
}

/** 常规底稿：单音、双音和弦组、带琶音的和弦组、收尾单音都有 */
const LOCAL_7 = generate(7);
/** 含休止拍位的底稿 */
const LOCAL_8 = generate(8);
/** 含高音弦（string 1）单音的底稿 */
const LOCAL_38 = generate(38);

function apply(
    local: LocalResult,
    patches: readonly PerformancePatch[],
    maxPatches = 16,
) {
    return applyPerformancePatches(
        local.notes,
        patches,
        local.options,
        PLAYABILITY,
        local.harmony,
        local.phrases,
        local.maxLeapSemitones,
        maxPatches,
    );
}

function slotsOf(local: LocalResult): SerializedImprovSlot[] {
    return serializeImprovSlots(local.notes, local.options);
}

function findSlot(
    local: LocalResult,
    predicate: (slot: SerializedImprovSlot) => boolean,
): SerializedImprovSlot {
    const slot = slotsOf(local).find(predicate);
    if (slot === undefined) throw new Error('测试底稿里没有匹配的拍位');
    return slot;
}

function singleSlots(local: LocalResult): SerializedImprovSlot[] {
    return slotsOf(local).filter(
        slot => !slot.rest && slot.notes?.length === 1,
    );
}

function patchAt(
    slot: SerializedImprovSlot,
    fields: Omit<PerformancePatch, 'measureIndex' | 'slotIndex'>,
): PerformancePatch {
    return {
        measureIndex: slot.measureIndex,
        slotIndex: slot.slotIndex,
        ...fields,
    };
}

/** 序列化拍位 → 拍平 notes 下标 */
function flatSlot(
    local: LocalResult,
    slot: SerializedImprovSlot,
): PerformanceSlot {
    const found = indexImprovSlots(local.notes, local.options).slots.find(
        candidate => candidate.measureIndex === slot.measureIndex
            && candidate.slotIndex === slot.slotIndex,
    );
    if (found === undefined) throw new Error('拍位索引与序列化结果不一致');
    return found;
}

function lastSoundingSlot(local: LocalResult): PerformanceSlot {
    const { slots } = indexImprovSlots(local.notes, local.options);
    const found = [...slots].reverse().find(slot => !slot.isRest);
    if (found === undefined) throw new Error('底稿没有发音拍位');
    return found;
}

function makeNote(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

/** 2 小节 4/4：单音 / 休止 / 双音和弦组 / 单音附点… 手写一份可对照的索引底稿 */
function manualNotes(): { notes: Note[]; options: ResolvedImprovOptions } {
    const options = makeOptions({
        numMeasures: 2,
        timeSignature: '4/4',
        key: 'C',
    });
    const notes: Note[] = [
        makeNote({ duration: 0.5, string: 1, fret: 0 }),
        { duration: 0.25, isRest: true },
        makeNote({ duration: 0.25, string: 2, fret: 1, chordGroup: 1 }),
        makeNote({ duration: 0.25, string: 3, fret: 0, chordGroup: 1 }),
        makeNote({ duration: 1, string: 1, fret: 3 }),
    ];
    return { notes, options };
}

describe('indexImprovSlots', () => {
    it('小节与拍位从 0 编号，休止也占 slot', () => {
        const { notes, options } = manualNotes();
        const { slots, errors } = indexImprovSlots(notes, options);

        expect(errors).toEqual([]);
        expect(slots.map(slot => [slot.measureIndex, slot.slotIndex]))
            .toEqual([[0, 0], [0, 1], [0, 2], [1, 0]]);
        expect(slots.map(slot => slot.isRest))
            .toEqual([false, true, false, false]);
        expect(slots.map(slot => slot.start))
            .toEqual([0, 0.5, 0.75, 0]);
    });

    it('和弦组只累加一次时值，noteStart/noteEnd 与 groupFlatNotes 对齐', () => {
        const { notes, options } = manualNotes();
        const { slots, errors } = indexImprovSlots(notes, options);
        const groups = groupFlatNotes(notes);

        expect(errors).toEqual([]);
        expect(groups.map(group => group.length)).toEqual([1, 1, 2, 1]);
        expect(slots.map(slot => [slot.noteStart, slot.noteEnd]))
            .toEqual([[0, 1], [1, 2], [2, 4], [4, 5]]);
        slots.forEach((slot, index) => {
            expect(notes.slice(slot.noteStart, slot.noteEnd))
                .toEqual(groups[index]);
        });
        // 和弦组时值只记一次，不因两个成员翻倍
        expect(slots[2].duration).toBe(0.25);
        expect(slots[3].start).toBe(0);
    });

    it('超过 numMeasures 的拍位被拒绝', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4' });
        const notes: Note[] = [
            makeNote({ duration: 0.5, fret: 0 }),
            makeNote({ duration: 0.5, fret: 2 }),
            makeNote({ duration: 0.5, fret: 3 }),
        ];

        const { slots, errors } = indexImprovSlots(notes, options);

        expect(slots).toHaveLength(2);
        expect(errors).toEqual(['拍位超出 1 小节容量']);
    });

    it('非法拍号返回 errors 且不产出拍位', () => {
        for (const timeSignature of ['4/x', '0/4']) {
            const { slots, errors } = indexImprovSlots(
                [makeNote({ duration: 1 })],
                makeOptions({ numMeasures: 2, timeSignature }),
            );
            expect(slots).toEqual([]);
            expect(errors).toEqual([`无效拍号: ${timeSignature}`]);
        }
    });

    it('空音符返回空索引', () => {
        const { slots, errors } = indexImprovSlots(
            [],
            makeOptions({ numMeasures: 2, timeSignature: '4/4' }),
        );
        expect(slots).toEqual([]);
        expect(errors).toEqual([]);
    });

    it('非法时值中断索引并报错', () => {
        const notes: Note[] = [
            makeNote({ duration: 0 as Note['duration'] }),
            makeNote({ duration: 0.5, fret: 2 }),
        ];

        const { slots, errors } = indexImprovSlots(
            notes,
            makeOptions({ numMeasures: 2, timeSignature: '4/4' }),
        );

        expect(slots).toEqual([]);
        expect(errors).toEqual(['第 1 个拍位时值非法: 0']);
    });
});

describe('serializeImprovSlots', () => {
    function serializeFixture(): Note[] {
        return [
            { duration: 0.5, isRest: true },
            {
                duration: 0.5,
                string: 2,
                fret: 7,
                technique: 'bend',
                bendAmount: 1,
                bendRelease: true,
                dynamics: 'soft',
                palmMute: true,
                deadNote: true,
                letRing: true,
                staccato: true,
                harmonic: 'artificial',
                harmonicFret: 12,
            },
            { duration: 0.5, string: 3, fret: 0, chordGroup: 1, arpeggio: 'up' },
            { duration: 0.5, string: 4, fret: 2, chordGroup: 1 },
            { duration: 0.5, string: 2, fret: 1, chordGroup: 2, strum: 'down' },
            { duration: 0.5, string: 1, fret: 0, chordGroup: 2 },
        ];
    }

    function serialize(): SerializedImprovSlot[] {
        return serializeImprovSlots(
            serializeFixture(),
            makeOptions({ numMeasures: 2, timeSignature: '4/4' }),
        );
    }

    it('休止输出 rest 且不带 notes', () => {
        const [rest] = serialize();

        expect(rest).toEqual({
            measureIndex: 0,
            slotIndex: 0,
            start: 0,
            duration: 0.5,
            role: 'strong',
            rest: true,
        });
        expect(rest.notes).toBeUndefined();
        expect(rest.chordGroup).toBeUndefined();
    });

    it('和弦组输出 chordGroup，组首 arpeggio/strum 透传', () => {
        const slots = serialize();

        expect(slots[2]).toEqual({
            measureIndex: 1,
            slotIndex: 0,
            start: 0,
            duration: 0.5,
            role: 'strong',
            chordGroup: 1,
            arpeggio: 'up',
            notes: [
                { string: 3, fret: 0 },
                { string: 4, fret: 2 },
            ],
        });
        expect(slots[3]).toEqual({
            measureIndex: 1,
            slotIndex: 1,
            start: 0.5,
            duration: 0.5,
            role: 'strong',
            chordGroup: 2,
            strum: 'down',
            notes: [
                { string: 2, fret: 1 },
                { string: 1, fret: 0 },
            ],
        });
    });

    it('单音输出弦品与已有表现字段', () => {
        const slots = serialize();

        expect(slots[1]).toEqual({
            measureIndex: 0,
            slotIndex: 1,
            start: 0.5,
            duration: 0.5,
            role: 'strong',
            notes: [{
                string: 2,
                fret: 7,
                technique: 'bend',
                bendAmount: 1,
                bendRelease: true,
                dynamics: 'soft',
                palmMute: true,
                deadNote: true,
                letRing: true,
                staccato: true,
                harmonic: 'artificial',
                harmonicFret: 12,
            }],
        });
    });

    it('索引失败时返回空数组', () => {
        expect(serializeImprovSlots(
            serializeFixture(),
            makeOptions({ numMeasures: 2, timeSignature: '4/x' }),
        )).toEqual([]);
    });
});

describe('applyPerformancePatches', () => {
    it('dynamics 改单音成功，且不修改输入 notes', () => {
        const slot = findSlot(LOCAL_7, candidate => !candidate.rest
            && candidate.notes?.length === 1
            && candidate.notes?.[0]?.dynamics === 'accent');
        const target = flatSlot(LOCAL_7, slot);
        const snapshot = structuredClone(LOCAL_7.notes);

        const result = apply(LOCAL_7, [patchAt(slot, { dynamics: 'soft' })]);

        expect(result.applied).toBe(1);
        expect(result.dropped).toEqual([]);
        expect(result.reverted).toBe(false);
        expect(result.notes[target.noteStart].dynamics).toBe('soft');
        expect(LOCAL_7.notes[target.noteStart].dynamics).toBe('accent');
        expect(LOCAL_7.notes).toEqual(snapshot);
    });

    it('dynamics:null 清除力度', () => {
        const slot = findSlot(LOCAL_7, candidate => !candidate.rest
            && candidate.notes?.length === 1
            && candidate.notes?.[0]?.dynamics === 'accent');
        const target = flatSlot(LOCAL_7, slot);

        const result = apply(LOCAL_7, [patchAt(slot, { dynamics: null })]);

        expect(result.applied).toBe(1);
        expect(result.notes[target.noteStart].dynamics).toBeUndefined();
        expect('dynamics' in result.notes[target.noteStart]).toBe(false);
    });

    it('不存在的拍位进 dropped，applied 不变', () => {
        const missingMeasure = apply(LOCAL_7, [
            { measureIndex: 9, slotIndex: 0, dynamics: 'soft' },
        ]);
        expect(missingMeasure.applied).toBe(0);
        expect(missingMeasure.dropped).toHaveLength(1);
        expect(missingMeasure.dropped[0].reason).toMatch(/找不到/);

        const missingSlot = apply(LOCAL_7, [
            { measureIndex: 0, slotIndex: 99, dynamics: 'soft' },
        ]);
        expect(missingSlot.applied).toBe(0);
        expect(missingSlot.dropped).toHaveLength(1);
        expect(missingSlot.dropped[0].reason).toMatch(/找不到/);
    });

    it('负数或非整数拍位索引进 dropped', () => {
        for (const patch of [
            { measureIndex: -1, slotIndex: 0, dynamics: 'soft' as const },
            { measureIndex: 0, slotIndex: 0.5, dynamics: 'soft' as const },
        ]) {
            const result = apply(LOCAL_7, [patch]);
            expect(result.applied).toBe(0);
            expect(result.dropped).toHaveLength(1);
            expect(result.dropped[0].reason).toBe('拍位索引非法');
        }
    });

    it('目标是休止符时 dropped', () => {
        const rest = findSlot(LOCAL_8, candidate => candidate.rest === true);

        const result = apply(LOCAL_8, [patchAt(rest, { dynamics: 'soft' })]);

        expect(result.applied).toBe(0);
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].reason).toBe('目标是休止符');
    });

    it('单音不能加 arpeggio/strum', () => {
        const slot = singleSlots(LOCAL_7)[0];

        for (const fields of [
            { arpeggio: 'up' as const },
            { strum: 'down' as const },
        ]) {
            const result = apply(LOCAL_7, [patchAt(slot, fields)]);
            expect(result.applied).toBe(0);
            expect(result.dropped).toHaveLength(1);
            expect(result.dropped[0].reason).toBe('单音不能加琶音/扫弦');
        }
    });

    it('和弦组只给 dynamics 时所有成员都变', () => {
        const chord = findSlot(LOCAL_7, candidate => candidate.notes?.length === 2);
        const target = flatSlot(LOCAL_7, chord);

        const result = apply(LOCAL_7, [patchAt(chord, { dynamics: 'soft' })]);

        expect(result.applied).toBe(1);
        for (let i = target.noteStart; i < target.noteEnd; i++) {
            expect(result.notes[i].dynamics).toBe('soft');
        }
    });

    it('和弦组 strum 成功且清掉 arpeggio', () => {
        const chord = findSlot(
            LOCAL_7,
            candidate => candidate.arpeggio !== undefined,
        );
        expect(chord.arpeggio).toBe('up');
        const target = flatSlot(LOCAL_7, chord);

        const result = apply(LOCAL_7, [patchAt(chord, { strum: 'down' })]);

        expect(result.applied).toBe(1);
        expect(result.notes[target.noteStart].strum).toBe('down');
        expect('arpeggio' in result.notes[target.noteStart]).toBe(false);
        expect(result.notes[target.noteStart + 1].strum).toBeUndefined();
    });

    it('和弦组同时给 arpeggio 与 strum 时 strum 生效', () => {
        const chord = findSlot(
            LOCAL_7,
            candidate => candidate.arpeggio !== undefined,
        );
        const target = flatSlot(LOCAL_7, chord);

        const result = apply(LOCAL_7, [
            patchAt(chord, { arpeggio: 'up', strum: 'down' }),
        ]);

        expect(result.applied).toBe(1);
        expect(result.notes[target.noteStart].strum).toBe('down');
        expect('arpeggio' in result.notes[target.noteStart]).toBe(false);
    });

    it('和弦组不接受单音奏法（清除写法同样拒绝）', () => {
        const chord = findSlot(LOCAL_7, candidate => candidate.notes?.length === 2);

        const forbidden: Array<Omit<
            PerformancePatch,
            'measureIndex' | 'slotIndex'
        >> = [
            { technique: 'vibrato' },
            { palmMute: true },
            { harmonic: 'natural' },
            { palmMute: false },
            { harmonic: null },
        ];
        for (const fields of forbidden) {
            const result = apply(LOCAL_7, [patchAt(chord, fields)]);
            expect(result.applied).toBe(0);
            expect(result.dropped).toHaveLength(1);
            expect(result.dropped[0].reason)
                .toBe('和弦组只允许改力度/琶音/扫弦');
        }
    });

    it('单音补丁按 制音 > 泛音 > 闷音 > 延音 > 技法 归一化', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4', key: 'C' });
        const notes: Note[] = [
            makeNote({ duration: 0.5, string: 4, fret: 2 }),
            makeNote({ duration: 0.5, string: 4, fret: 3 }),
        ];

        const result = applyPerformancePatches(
            notes,
            [{
                measureIndex: 0,
                slotIndex: 0,
                technique: 'bend',
                bendAmount: 0.5,
                letRing: true,
                palmMute: true,
                harmonic: 'artificial',
                staccato: true,
                deadNote: true,
            }],
            options,
            PLAYABILITY,
            [],
            [],
            PLAYABILITY.maxLeapSemitones,
            8,
        );

        expect(result.applied).toBe(1);
        expect(result.dropped).toEqual([]);
        const note = result.notes[0];
        expect(note.deadNote).toBe(true);
        expect(note.harmonic).toBeUndefined();
        expect(note.palmMute).toBeUndefined();
        expect(note.letRing).toBeUndefined();
        expect(note.staccato).toBeUndefined();
        expect(note.technique).toBeUndefined();
        expect(note.bendAmount).toBeUndefined();
    });

    it('不产生实际变化的补丁进 dropped', () => {
        const slot = singleSlots(LOCAL_7)[0];

        const result = apply(LOCAL_7, [patchAt(slot, { arpeggio: null })]);

        expect(result.applied).toBe(0);
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].reason).toBe('补丁没有产生实际变化');
        expect(result.notes).toEqual(LOCAL_7.notes);
    });

    it('高音弦手掌闷音被 validateNotes 拒绝', () => {
        const slot = findSlot(LOCAL_38, candidate => candidate.notes?.length === 1
            && candidate.notes?.[0]?.string === 1);

        const result = apply(LOCAL_38, [patchAt(slot, { palmMute: true })]);

        expect(result.applied).toBe(0);
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].reason).toMatch(/手掌闷音只能用在低音弦/);
    });

    it('最后一个发音拍位不能加制音', () => {
        const last = lastSoundingSlot(LOCAL_7);

        const result = apply(LOCAL_7, [{
            measureIndex: last.measureIndex,
            slotIndex: last.slotIndex,
            deadNote: true,
        }]);

        expect(result.applied).toBe(0);
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].reason).toBe('最后一个发音拍位不能加制音');
    });

    it('部分接受：合法补丁生效，非法补丁进 dropped', () => {
        const [legalSlot, illegalSlot] = singleSlots(LOCAL_7);
        const legal = patchAt(legalSlot, { dynamics: 'soft' });
        const illegal = patchAt(illegalSlot, { arpeggio: 'up' });
        const target = flatSlot(LOCAL_7, legalSlot);

        const result = apply(LOCAL_7, [legal, illegal]);

        expect(result.applied).toBe(1);
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].patch).toBe(illegal);
        expect(result.dropped[0].reason).toBe('单音不能加琶音/扫弦');
        expect(result.notes[target.noteStart].dynamics).toBe('soft');
    });

    it('maxPatches 为 0 时全部进 dropped', () => {
        const singles = singleSlots(LOCAL_7).slice(0, 2);
        const patches = singles.map(slot => patchAt(slot, { dynamics: 'soft' }));

        const result = apply(LOCAL_7, patches, 0);

        expect(result.applied).toBe(0);
        expect(result.notes).toEqual(LOCAL_7.notes);
        expect(result.dropped).toHaveLength(2);
        for (const rejected of result.dropped) {
            expect(rejected.reason).toBe('超出单次最多 0 处扩展');
        }
    });

    it('maxPatches 为 1 时只尝试第一条', () => {
        const singles = singleSlots(LOCAL_7).slice(0, 2);
        const patches = singles.map(slot => patchAt(slot, { dynamics: 'soft' }));
        const first = flatSlot(LOCAL_7, singles[0]);
        const second = flatSlot(LOCAL_7, singles[1]);

        const result = apply(LOCAL_7, patches, 1);

        expect(result.applied).toBe(1);
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].patch).toBe(patches[1]);
        expect(result.dropped[0].reason).toBe('超出单次最多 1 处扩展');
        expect(result.notes[first.noteStart].dynamics).toBe('soft');
        expect(result.notes[second.noteStart].dynamics).toBeUndefined();
    });

    it('同样输入调用两次结果深相等', () => {
        const slots = singleSlots(LOCAL_7).slice(0, 2);
        const patches = [
            patchAt(slots[0], { dynamics: 'soft' }),
            patchAt(slots[1], { arpeggio: 'up' }),
        ];

        const first = apply(LOCAL_7, patches);
        const second = apply(LOCAL_7, patches);

        expect(first).toEqual(second);
        expect(first.notes).not.toBe(second.notes);
    });

    it('补丁没有任何表现字段 → dropped', () => {
        const slot = singleSlots(LOCAL_7)[0];

        const result = apply(LOCAL_7, [patchAt(slot, {})]);

        expect(result.applied).toBe(0);
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].reason).toBe('补丁没有任何表现字段');
        expect(result.notes).toEqual(LOCAL_7.notes);
    });

    it('未知字段被忽略，合法字段照常生效', () => {
        const slot = singleSlots(LOCAL_7).find(
            candidate => candidate.notes?.[0]?.dynamics === undefined,
        );
        if (slot === undefined) throw new Error('测试底稿里没有无力度单音');
        const target = flatSlot(LOCAL_7, slot);
        const unknown = {
            measureIndex: slot.measureIndex,
            slotIndex: slot.slotIndex,
            dynamics: 'accent',
            string: 5,
            fret: 99,
        } as unknown as PerformancePatch;

        const result = apply(LOCAL_7, [unknown]);

        expect(result.applied).toBe(1);
        expect(result.dropped).toEqual([]);
        expect(result.notes[target.noteStart].dynamics).toBe('accent');
        expect(result.notes[target.noteStart].fret)
            .toBe(LOCAL_7.notes[target.noteStart].fret);
        expect(result.notes[target.noteStart].string)
            .toBe(LOCAL_7.notes[target.noteStart].string);
    });

    it('没有表现字段的补丁被丢弃', () => {
        const slot = singleSlots(LOCAL_7)[0];
        const unknown = {
            measureIndex: slot.measureIndex,
            slotIndex: slot.slotIndex,
            string: 1,
            fret: 99,
        } as unknown as PerformancePatch;

        const result = apply(LOCAL_7, [unknown]);

        expect(result.applied).toBe(0);
        expect(result.dropped).toHaveLength(1);
        expect(result.notes).toEqual(LOCAL_7.notes);
    });

    it('索引不一致时整份回退', () => {
        const notes: Note[] = [makeNote({ duration: 1 })];
        const options = makeOptions({
            numMeasures: 1,
            timeSignature: '4/x',
        });

        const result = applyPerformancePatches(
            notes,
            [],
            options,
            PLAYABILITY,
            [],
            [],
            PLAYABILITY.maxLeapSemitones,
            8,
        );

        expect(result.reverted).toBe(true);
        expect(result.applied).toBe(0);
        expect(result.dropped).toEqual([]);
        expect(result.finalErrors).toEqual(['无效拍号: 4/x']);
        expect(result.notes).toEqual(notes);
    });
});
