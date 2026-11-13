/**
 * generate — 本地即兴端到端与 store 对接测试。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LOCAL_IMPROV_CONFIG, SCORE_DEFAULTS } from '../../../../core/config.ts';
import { scoreStore } from '../../../../core/stores/scoreStore.ts';
import type { Note } from '../../../../core/types/index.ts';
import type {
    LocalStyle,
    ScaleType,
} from '../../../../core/types/improv.ts';
import {
    generateLocalImprovisation,
    resolveLocalImprovOptions,
} from '../../../../core/utils/improv/generate.ts';
import { validatePhrasePlan } from '../../../../core/utils/improv/phrase.ts';
import {
    fretToMidi,
    pitchClassOf,
} from '../../../../core/utils/improv/pitch.ts';
import { capacityFromTimeSignature } from '../../../../core/utils/measureUtils.ts';
import { groupFlatNotes } from '../../../../core/utils/noteGroup.ts';

/** 拍位总时值：和弦组只计一次，避免把同拍位的多声部重复累加。 */
function groupedDuration(notes: readonly Note[]): number {
    return groupFlatNotes(notes).reduce(
        (sum, group) => sum + group[0].duration, 0,
    );
}

interface Case {
    style: LocalStyle;
    scaleType: ScaleType;
    key: string;
}

const CASES: Case[] = [
    { style: 'Folk', scaleType: 'Major (Ionian)', key: 'C' },
    { style: 'Blues', scaleType: 'Blues', key: 'A' },
    { style: 'Rock', scaleType: 'Natural Minor (Aeolian)', key: 'E' },
    { style: 'Jazz', scaleType: 'Dorian', key: 'D' },
    { style: 'Classical', scaleType: 'Harmonic Minor', key: 'A' },
];

beforeEach(() => {
    scoreStore.score.measures = [];
    scoreStore.score.tuning = { ...SCORE_DEFAULTS.tuning };
    scoreStore.score.bpm = SCORE_DEFAULTS.bpm;
    scoreStore.score.key = SCORE_DEFAULTS.key;
    scoreStore.score.timeSignature = SCORE_DEFAULTS.timeSignature;
    scoreStore.selectedMeasure = null;
    scoreStore.onChange = null;
    scoreStore.onSelectChange = null;
    scoreStore._batchDepth = 0;
});

describe('resolveLocalImprovOptions', () => {
    it('空输入使用默认配置', () => {
        expect(resolveLocalImprovOptions()).toMatchObject({
            numMeasures: 4,
            key: 'C',
            tonicPitchClass: 0,
            scaleType: 'Major (Ionian)',
            style: 'Rock',
            density: '中',
            timeSignature: '4/4',
            seed: 1,
        });
        expect(resolveLocalImprovOptions().tuning)
            .toEqual(SCORE_DEFAULTS.tuning);
    });

    it('解析调性并克隆调弦', () => {
        const tuning = { ...SCORE_DEFAULTS.tuning, string6: 'D2' };
        const options = resolveLocalImprovOptions({ key: 'Am', tuning });
        expect(options.key).toBe('Am');
        expect(options.tonicPitchClass).toBe(9);
        expect(options.tuning).toEqual(tuning);
        expect(options.tuning).not.toBe(tuning);
    });

    it('非法输入回落到默认值，小节数夹在配置范围内', () => {
        expect(resolveLocalImprovOptions({ key: 'H' }).key).toBe('C');
        expect(resolveLocalImprovOptions({
            style: 'Techno' as LocalStyle,
            density: '极高' as never,
            timeSignature: '11/16',
        })).toMatchObject({
            style: 'Rock',
            density: '中',
            timeSignature: '4/4',
        });
        expect(resolveLocalImprovOptions({ numMeasures: 1 }).numMeasures)
            .toBe(LOCAL_IMPROV_CONFIG.numMeasures.min);
        expect(resolveLocalImprovOptions({ numMeasures: 99 }).numMeasures)
            .toBe(LOCAL_IMPROV_CONFIG.numMeasures.max);
        expect(resolveLocalImprovOptions({ seed: 3.9 }).seed).toBe(3);
    });
});

describe('generateLocalImprovisation', () => {
    it('默认输入生成 4 小节，总时值闭合且音符合法', () => {
        const { notes, options } = generateLocalImprovisation();
        expect(options.numMeasures).toBe(4);
        expect(notes.length).toBeGreaterThan(0);

        const total = groupedDuration(notes);
        expect(total).toBeCloseTo(
            capacityFromTimeSignature(options.timeSignature) * options.numMeasures,
            9,
        );

        for (const note of notes) {
            if (note.isRest) {
                expect(note.duration).toBeGreaterThan(0);
                continue;
            }
            expect(note.string).toBeGreaterThanOrEqual(1);
            expect(note.string).toBeLessThanOrEqual(6);
            expect(note.fret).toBeGreaterThanOrEqual(0);
            expect(note.fret).toBeLessThanOrEqual(24);
            expect(note.technique === undefined
                || note.technique === 'bend'
                || note.technique === 'vibrato'
                || note.technique === 'hammerOn'
                || note.technique === 'pullOff'
                || note.technique === 'slide').toBe(true);
            // 生成结果只写到达品，targetFret 仅属于表单/编辑器
            expect(note.targetFret).toBeUndefined();
            // 本次不生成延音/和弦名；和弦组 id 必须是正整数
            expect(note.tieToNext).toBeUndefined();
            expect(note.chordName).toBeUndefined();
            if (note.chordGroup !== undefined) {
                expect(Number.isInteger(note.chordGroup)).toBe(true);
                expect(note.chordGroup).toBeGreaterThan(0);
            }
            expect(note.harmonic === undefined
                || note.harmonic === 'natural'
                || note.harmonic === 'artificial'
                || note.harmonic === 'pinch').toBe(true);
            expect(note.arpeggio === undefined
                || note.arpeggio === 'up'
                || note.arpeggio === 'down').toBe(true);
            expect(note.strum === undefined
                || note.strum === 'up'
                || note.strum === 'down').toBe(true);
        }
    });

    it('连接类技法只标在紧邻的同弦前音上', () => {
        let found = 0;
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 12; seed++) {
                const { notes } = generateLocalImprovisation({
                    numMeasures: 4,
                    key: caseItem.key,
                    scaleType: caseItem.scaleType,
                    style: caseItem.style,
                    seed,
                });
                const groups = groupFlatNotes(notes);
                groups.forEach((group, groupIndex) => {
                    if (group.length !== 1) return;
                    const note = group[0];
                    if (note.technique !== 'hammerOn'
                        && note.technique !== 'pullOff'
                        && note.technique !== 'slide') return;
                    found++;
                    const previousGroup = groups[groupIndex - 1];
                    expect(previousGroup).toBeDefined();
                    expect(previousGroup).toHaveLength(1);
                    const previous = previousGroup[0];
                    expect(previous.isRest).not.toBe(true);
                    expect(previous.string).toBe(note.string);
                    expect(note.targetFret).toBeUndefined();

                    const span = Math.abs(note.fret! - previous.fret!);
                    if (note.technique === 'slide') {
                        expect(span).toBeGreaterThanOrEqual(1);
                        expect(span).toBeLessThanOrEqual(
                            LOCAL_IMPROV_CONFIG.playability.maxSlideFrets,
                        );
                        // 空弦没有按弦手指可移动，两端都不能是空弦
                        expect(previous.fret!).toBeGreaterThanOrEqual(1);
                        expect(note.fret!).toBeGreaterThanOrEqual(1);
                    } else {
                        expect(span).toBeGreaterThanOrEqual(1);
                        expect(span).toBeLessThanOrEqual(
                            LOCAL_IMPROV_CONFIG.playability.maxHammerPullFrets,
                        );
                        if (note.technique === 'hammerOn') {
                            expect(note.fret!).toBeGreaterThan(previous.fret!);
                        } else {
                            expect(note.fret!).toBeLessThan(previous.fret!);
                        }
                    }
                });
            }
        }
        expect(found).toBeGreaterThan(0);
    });

    it('所有风格 × 多 seed 都能生成', () => {
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 5; seed++) {
                const { notes } = generateLocalImprovisation({
                    numMeasures: 2,
                    key: caseItem.key,
                    scaleType: caseItem.scaleType,
                    style: caseItem.style,
                    seed,
                });
                expect(notes.some(note => !note.isRest)).toBe(true);
            }
        }
    });

    it('收尾主音回归：不会再因超限跳进而抛错', () => {
        const { notes, options } = generateLocalImprovisation({
            numMeasures: 2,
            key: 'D',
            scaleType: 'Major (Ionian)',
            style: 'Jazz',
            density: '低',
            timeSignature: '4/4',
            seed: 2,
        });
        const sounding = groupFlatNotes(notes)
            .filter(group => !group[0].isRest);
        const topMidi = (group: typeof sounding[number]): number => Math.max(
            ...group
                .filter(note => note.string !== undefined && note.fret !== undefined)
                .map(note => fretToMidi(options.tuning, note.string!, note.fret!)),
        );
        const last = sounding[sounding.length - 1];
        const previous = sounding[sounding.length - 2];
        const lastMidi = topMidi(last);
        const previousMidi = topMidi(previous);
        expect(pitchClassOf(lastMidi)).toBe(options.tonicPitchClass);
        expect(Math.abs(lastMidi - previousMidi))
            .toBeLessThanOrEqual(LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones);
    });

    it('支持配置上限 16 小节，且 loadNotes 不丢音/不并小节', () => {
        const { notes, options } = generateLocalImprovisation({
            numMeasures: 16,
            timeSignature: '12/8',
            seed: 3,
        });
        expect(options.numMeasures).toBe(16);
        scoreStore.setTimeSignature(options.timeSignature);
        const written = scoreStore.loadNotes(notes, options.numMeasures);
        expect(written).toBe(notes.length);
        expect(scoreStore.score.measures).toHaveLength(16);
        const capacity = capacityFromTimeSignature(options.timeSignature);
        for (const measure of scoreStore.score.measures) {
            expect(groupedDuration(measure.notes)).toBeCloseTo(capacity, 9);
        }
    });

    it('强制高和弦概率时生成和弦组，loadNotes 后小节时值仍闭合', () => {
        // 深拷贝配置，避免污染全局 LOCAL_IMPROV_CONFIG
        const config = JSON.parse(
            JSON.stringify(LOCAL_IMPROV_CONFIG),
        ) as typeof LOCAL_IMPROV_CONFIG;
        config.styleProfiles.Rock.chordProbability = 1;
        config.styleProfiles.Rock.arpeggioProbability = 1;
        config.styleProfiles.Rock.strumProbability = 1;

        const { notes, options } = generateLocalImprovisation({
            numMeasures: 8,
            key: 'C',
            style: 'Rock',
            seed: 1,
        }, config);

        const chordGroups = groupFlatNotes(notes)
            .filter(group => group.length > 1);
        expect(chordGroups.length).toBeGreaterThan(0);
        expect(chordGroups.every(group => group[0].chordGroup !== undefined))
            .toBe(true);
        // 扫弦优先于琶音，且只写在组首
        expect(chordGroups.every(group => group[0].strum !== undefined)).toBe(true);
        expect(chordGroups.every(group => group.slice(1)
            .every(note => note.strum === undefined
                && note.arpeggio === undefined))).toBe(true);

        scoreStore.setTimeSignature(options.timeSignature);
        const written = scoreStore.loadNotes(notes, options.numMeasures);
        expect(written).toBe(notes.length);
        expect(scoreStore.score.measures).toHaveLength(options.numMeasures);

        const capacity = capacityFromTimeSignature(options.timeSignature);
        for (const measure of scoreStore.score.measures) {
            expect(groupedDuration(measure.notes)).toBeCloseTo(capacity, 9);
        }

        // 含和弦组的小节也按拍位闭合，而非逐音重复累加
        const chordMeasure = scoreStore.score.measures.find(
            measure => measure.notes.some(note => note.chordGroup !== undefined),
        );
        expect(chordMeasure).toBeDefined();
        expect(groupedDuration(chordMeasure!.notes)).toBeCloseTo(capacity, 9);
    });

    it('收尾音达到终止时值，且不带制音/断音/闷音', () => {
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 8; seed++) {
                const { notes } = generateLocalImprovisation({
                    numMeasures: 4,
                    key: caseItem.key,
                    scaleType: caseItem.scaleType,
                    style: caseItem.style,
                    seed,
                });
                const sounding = groupFlatNotes(notes)
                    .filter(group => !group[0].isRest);
                const last = sounding[sounding.length - 1];
                expect(last[0].duration).toBeGreaterThanOrEqual(
                    LOCAL_IMPROV_CONFIG.styleProfiles[caseItem.style]
                        .phrase.cadenceMinDuration - 1e-9,
                );
                expect(last.every(note => !note.deadNote
                    && !note.staccato
                    && !note.palmMute)).toBe(true);
            }
        }
    });

    it('同选项同 seed 完全一致，换 seed 不保证一致', () => {
        const input = { numMeasures: 2, key: 'G', style: 'Rock' as const };
        expect(generateLocalImprovisation({ ...input, seed: 8 }).notes)
            .toEqual(generateLocalImprovisation({ ...input, seed: 8 }).notes);
    });

    it('结果可直接交给 scoreStore.loadNotes，且小节数/容量保持不变', () => {
        for (const signature of LOCAL_IMPROV_CONFIG.timeSignatures) {
            for (let seed = 1; seed <= 3; seed++) {
                const { notes, options } = generateLocalImprovisation({
                    numMeasures: 2,
                    timeSignature: signature,
                    seed,
                });
                scoreStore.setTimeSignature(options.timeSignature);
                const written = scoreStore.loadNotes(notes, options.numMeasures);

                expect(written).toBe(notes.length);
                expect(scoreStore.score.measures).toHaveLength(options.numMeasures);
                expect(scoreStore.score.timeSignature).toBe(options.timeSignature);
                const capacity = capacityFromTimeSignature(signature);
                for (const measure of scoreStore.score.measures) {
                    expect(measure.notes.length).toBeGreaterThan(0);
                    expect(groupedDuration(measure.notes))
                        .toBeCloseTo(capacity, 9);
                }
            }
        }
    });
});

describe('generateLocalImprovisation（乐句计划）', () => {
    it('结果带完整乐句计划，首句 statement、末句 cadence', () => {
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 5; seed++) {
                const { phrases, options } = generateLocalImprovisation({
                    numMeasures: 8,
                    key: caseItem.key,
                    scaleType: caseItem.scaleType,
                    style: caseItem.style,
                    seed,
                });
                expect(validatePhrasePlan(phrases, options)).toEqual([]);
                expect(phrases[0].startMeasure).toBe(0);
                expect(phrases[phrases.length - 1].endMeasure).toBe(8);
                expect(phrases[0].role).toBe('statement');
                expect(phrases[phrases.length - 1].role).toBe('cadence');
            }
        }
    });

    it('同选项同 seed 的乐句计划完全一致', () => {
        const input = {
            numMeasures: 6, key: 'G', style: 'Rock' as const, seed: 9,
        };
        expect(generateLocalImprovisation(input).phrases)
            .toEqual(generateLocalImprovisation(input).phrases);
    });

    it('乐句感知生成的 16 小节可完整写入 store', () => {
        const { notes, options, phrases } = generateLocalImprovisation({
            numMeasures: 16,
            timeSignature: '4/4',
            seed: 5,
        });
        expect(phrases[phrases.length - 1].endMeasure).toBe(16);
        scoreStore.setTimeSignature(options.timeSignature);
        expect(scoreStore.loadNotes(notes, options.numMeasures))
            .toBe(notes.length);
        expect(scoreStore.score.measures).toHaveLength(16);
    });
});
