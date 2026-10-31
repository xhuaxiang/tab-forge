/**
 * generate — 本地即兴端到端与 store 对接测试。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LOCAL_IMPROV_CONFIG, SCORE_DEFAULTS } from '../../../../core/config.ts';
import { scoreStore } from '../../../../core/stores/scoreStore.ts';
import type {
    LocalStyle,
    ScaleType,
} from '../../../../core/types/improv.ts';
import {
    generateLocalImprovisation,
    resolveLocalImprovOptions,
} from '../../../../core/utils/improv/generate.ts';
import {
    fretToMidi,
    pitchClassOf,
} from '../../../../core/utils/improv/pitch.ts';
import { capacityFromTimeSignature } from '../../../../core/utils/measureUtils.ts';

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
            style: 'Folk',
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
            style: 'Folk',
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

        const total = notes.reduce((sum, note) => sum + note.duration, 0);
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
                || note.technique === 'vibrato').toBe(true);
            expect(note.chordGroup).toBeUndefined();
            expect(note.deadNote).toBeUndefined();
            expect(note.letRing).toBeUndefined();
            expect(note.staccato).toBeUndefined();
        }
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
        const sounding = notes.filter(note =>
            !note.isRest && note.string !== undefined && note.fret !== undefined);
        const last = sounding[sounding.length - 1];
        const previous = sounding[sounding.length - 2];
        const lastMidi = fretToMidi(options.tuning, last.string!, last.fret!);
        const previousMidi = fretToMidi(options.tuning, previous.string!, previous.fret!);
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
            const total = measure.notes.reduce((sum, note) => sum + note.duration, 0);
            expect(total).toBeCloseTo(capacity, 9);
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
                    const total = measure.notes.reduce(
                        (sum, note) => sum + note.duration, 0,
                    );
                    expect(total).toBeCloseTo(capacity, 9);
                }
            }
        }
    });
});
