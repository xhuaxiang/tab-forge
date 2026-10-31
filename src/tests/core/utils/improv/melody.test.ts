/**
 * melody — 调内、强拍/句尾稳定音、音程上限与确定性测试。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type {
    LocalStyle,
    ScaleType,
} from '../../../../core/types/improv.ts';
import { buildHarmonyPlan } from '../../../../core/utils/improv/harmony.ts';
import { buildPhrasePlan, phraseForMeasure } from '../../../../core/utils/improv/phrase.ts';
import { buildRhythmPlan } from '../../../../core/utils/improv/rhythm.ts';
import { buildSkeleton } from '../../../../core/utils/improv/melody.ts';
import {
    isInScale,
    midiRangeForFretRange,
    pitchClassOf,
    scalePitchClasses,
    tonicTriadPitchClasses,
} from '../../../../core/utils/improv/pitch.ts';
import { createRng } from '../../../../core/utils/improv/random.ts';
import { makeOptions } from './testOptions.ts';

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

function build(caseItem: Case, seed: number) {
    const options = makeOptions({
        numMeasures: 4,
        key: caseItem.key,
        scaleType: caseItem.scaleType,
        style: caseItem.style,
        density: '中',
        seed,
    });
    const rhythm = buildRhythmPlan(
        options,
        LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
        LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
        createRng(seed),
    );
    const skeleton = buildSkeleton(
        rhythm,
        options,
        LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
        LOCAL_IMPROV_CONFIG.playability,
        createRng(seed + 100),
    );
    return { options, rhythm, skeleton };
}

describe('buildSkeleton', () => {
    it('所有发音在调内，强拍与句尾落在主三和弦', () => {
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 5; seed++) {
                const { options, skeleton } = build(caseItem, seed);
                const triad = tonicTriadPitchClasses(
                    options.tonicPitchClass, options.scaleType,
                );

                for (const slot of skeleton) {
                    if (slot.isRest) {
                        expect(slot.midis).toEqual([]);
                        continue;
                    }
                    expect(slot.midis).toHaveLength(1);
                    expect(isInScale(
                        slot.midis[0], options.tonicPitchClass, options.scaleType,
                    )).toBe(true);
                    if (slot.role === 'strong') {
                        expect(triad).toContain(pitchClassOf(slot.midis[0]));
                    }
                }

                for (let measureIndex = 0; measureIndex < options.numMeasures; measureIndex++) {
                    const sounding = skeleton.filter(slot =>
                        slot.measureIndex === measureIndex && !slot.isRest);
                    expect(sounding.length).toBeGreaterThan(0);
                    const last = sounding[sounding.length - 1];
                    expect(triad).toContain(pitchClassOf(last.midis[0]));
                }
            }
        }
    });

    it('全曲最后一个音落在主音', () => {
        for (const caseItem of CASES) {
            const { options, skeleton } = build(caseItem, 3);
            const sounding = skeleton.filter(slot => !slot.isRest);
            const last = sounding[sounding.length - 1];
            expect(pitchClassOf(last.midis[0])).toBe(options.tonicPitchClass);
        }
    });

    it('段落中间不超过风格上限，最后一个音不超过可演奏上限', () => {
        for (const caseItem of CASES) {
            const { options, skeleton } = build(caseItem, 4);
            const style = LOCAL_IMPROV_CONFIG.styleProfiles[caseItem.style];
            const maxLeap = Math.min(
                style.maxLeapSemitones,
                LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones,
            );
            const sounding = skeleton.filter(slot => !slot.isRest);

            sounding.forEach((slot, index) => {
                if (index === 0) return;
                const previous = sounding[index - 1].midis[0];
                const isFinal = index === sounding.length - 1;
                const limit = isFinal
                    ? LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones
                    : maxLeap;
                expect(Math.abs(slot.midis[0] - previous)).toBeLessThanOrEqual(limit);
                if (isFinal) {
                    expect(pitchClassOf(slot.midis[0])).toBe(options.tonicPitchClass);
                }
            });
        }
    });

    it('D 大调 Jazz 低密度回归：收尾主音不再产生超限跳进', () => {
        const options = makeOptions({
            numMeasures: 2,
            key: 'D',
            scaleType: 'Major (Ionian)',
            style: 'Jazz',
            density: '低',
            timeSignature: '4/4',
            seed: 2,
        });
        const rhythm = buildRhythmPlan(
            options,
            LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
            LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
            createRng(options.seed),
        );
        const skeleton = buildSkeleton(
            rhythm,
            options,
            LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
            LOCAL_IMPROV_CONFIG.playability,
            createRng(options.seed + 1),
        );
        const sounding = skeleton.filter(slot => !slot.isRest);
        const last = sounding[sounding.length - 1];
        const previous = sounding[sounding.length - 2];
        expect(pitchClassOf(last.midis[0])).toBe(options.tonicPitchClass);
        expect(Math.abs(last.midis[0] - previous.midis[0]))
            .toBeLessThanOrEqual(LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones);
    });

    it('跨风格/调性 fuzz：中段守风格上限，收尾落主音且不超可演奏上限', () => {
        const keys = ['C', 'D', 'A', 'E', 'F#', 'Am', 'Em', 'Bbm'];
        for (const caseItem of CASES) {
            const style = LOCAL_IMPROV_CONFIG.styleProfiles[caseItem.style];
            const maxLeap = Math.min(
                style.maxLeapSemitones,
                LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones,
            );
            for (const key of keys) {
                for (let seed = 1; seed <= 10; seed++) {
                    const options = makeOptions({
                        numMeasures: 2,
                        key,
                        scaleType: caseItem.scaleType,
                        style: caseItem.style,
                        density: '高',
                        seed,
                    });
                    const rhythm = buildRhythmPlan(
                        options,
                        LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
                        style,
                        createRng(seed),
                    );
                    const skeleton = buildSkeleton(
                        rhythm, options, style,
                        LOCAL_IMPROV_CONFIG.playability,
                        createRng(seed + 1),
                    );
                    const sounding = skeleton.filter(slot => !slot.isRest);
                    const last = sounding[sounding.length - 1];
                    expect(pitchClassOf(last.midis[0])).toBe(options.tonicPitchClass);

                    sounding.forEach((slot, index) => {
                        if (index === 0) return;
                        const leap = Math.abs(
                            slot.midis[0] - sounding[index - 1].midis[0],
                        );
                        const isFinal = index === sounding.length - 1;
                        expect(leap).toBeLessThanOrEqual(isFinal
                            ? LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones
                            : maxLeap);
                    });
                }
            }
        }
    });

    it('音高落在音阶内且同 seed 可复现', () => {
        const caseItem = CASES[0];
        const first = build(caseItem, 21);
        const second = build(caseItem, 21);
        expect(first.skeleton).toEqual(second.skeleton);

        const scale = new Set(scalePitchClasses(
            first.options.tonicPitchClass, first.options.scaleType,
        ));
        for (const slot of first.skeleton) {
            if (!slot.isRest) expect(scale.has(pitchClassOf(slot.midis[0]))).toBe(true);
        }
    });
});

describe('buildSkeleton（乐句感知）', () => {
    function buildPhrased(
        caseItem: Case,
        seed: number,
        numMeasures = 8,
    ) {
        const options = makeOptions({
            numMeasures,
            key: caseItem.key,
            scaleType: caseItem.scaleType,
            style: caseItem.style,
            density: '中',
            seed,
        });
        const style = LOCAL_IMPROV_CONFIG.styleProfiles[caseItem.style];
        const playability = LOCAL_IMPROV_CONFIG.playability;
        const phrases = buildPhrasePlan(
            options, style, playability, createRng(seed + 4),
        );
        const rhythm = buildRhythmPlan(
            options,
            LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
            style,
            createRng(seed),
            phrases,
        );
        const skeleton = buildSkeleton(
            rhythm, options, style, playability,
            createRng(seed + 1), undefined, phrases,
        );
        return { options, style, playability, phrases, skeleton };
    }

    it('每个发音标注所属乐句，且音高落在该句把位窗口内（全曲末音除外）', () => {
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 5; seed++) {
                const { options, phrases, skeleton } = buildPhrased(caseItem, seed);
                const sounding = skeleton.filter(slot => !slot.isRest);
                const final = sounding[sounding.length - 1];

                for (const slot of sounding) {
                    expect(slot.phraseIndex).toBeDefined();
                    const phrase = phraseForMeasure(phrases, slot.measureIndex);
                    expect(slot.phraseIndex).toBe(phrase.index);
                    if (slot === final) continue;

                    const [low, high] = midiRangeForFretRange(
                        options.tuning, phrase.fretMin, phrase.fretMax,
                    );
                    expect(slot.midis[0]).toBeGreaterThanOrEqual(low);
                    expect(slot.midis[0]).toBeLessThanOrEqual(high);
                }
            }
        }
    });

    it('每小节末音与每句首音落和弦音，全曲末音落主音', () => {
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 5; seed++) {
                const { options, phrases, skeleton } = buildPhrased(caseItem, seed);
                const harmony = buildHarmonyPlan(options);
                const sounding = skeleton.filter(slot => !slot.isRest);
                const final = sounding[sounding.length - 1];
                expect(pitchClassOf(final.midis[0])).toBe(options.tonicPitchClass);

                for (let measureIndex = 0; measureIndex < options.numMeasures; measureIndex++) {
                    const chordTones = harmony[measureIndex].segments[0]
                        .pool.chordPitchClasses;
                    const inMeasure = sounding.filter(slot =>
                        slot.measureIndex === measureIndex);
                    expect(inMeasure.length).toBeGreaterThan(0);
                    expect(chordTones).toContain(
                        pitchClassOf(inMeasure[inMeasure.length - 1].midis[0]),
                    );
                }

                for (const phrase of phrases) {
                    const first = sounding.find(slot =>
                        slot.measureIndex >= phrase.startMeasure
                        && slot.measureIndex < phrase.endMeasure);
                    const chordTones = harmony[first!.measureIndex].segments[0]
                        .pool.chordPitchClasses;
                    expect(chordTones).toContain(pitchClassOf(first!.midis[0]));
                }
            }
        }
    });

    it('句内不超过风格上限，句间与末音放宽到换把上限', () => {
        for (const caseItem of CASES) {
            const style = LOCAL_IMPROV_CONFIG.styleProfiles[caseItem.style];
            const playability = LOCAL_IMPROV_CONFIG.playability;
            const styleLeap = Math.min(
                style.maxLeapSemitones, playability.maxLeapSemitones,
            );
            for (let seed = 1; seed <= 10; seed++) {
                const { skeleton } = buildPhrased(caseItem, seed);
                const sounding = skeleton.filter(slot => !slot.isRest);
                sounding.forEach((slot, index) => {
                    if (index === 0) return;
                    const previous = sounding[index - 1];
                    const isFinal = index === sounding.length - 1;
                    const samePhrase = slot.phraseIndex === previous.phraseIndex;
                    const limit = isFinal || !samePhrase
                        ? playability.maxPhraseLeapSemitones
                        : styleLeap;
                    expect(Math.abs(slot.midis[0] - previous.midis[0]))
                        .toBeLessThanOrEqual(limit);
                });
            }
        }
    });

    it('不会出现三连机械同音（锚点/经过音除外）', () => {
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 10; seed++) {
                const { skeleton } = buildPhrased(caseItem, seed);
                const sounding = skeleton.filter(slot => !slot.isRest);
                const lastOfMeasure = new Map<number, number>();
                const lastOfPhrase = new Map<number, number>();
                sounding.forEach((slot, index) => {
                    lastOfMeasure.set(slot.measureIndex, index);
                    lastOfPhrase.set(slot.phraseIndex ?? -1, index);
                });
                const isAnchor = (index: number) => {
                    const slot = sounding[index];
                    return slot.role === 'strong'
                        || slot.role === 'passing'
                        || lastOfMeasure.get(slot.measureIndex) === index
                        || lastOfPhrase.get(slot.phraseIndex ?? -1) === index;
                };

                for (let index = 2; index < sounding.length; index++) {
                    const same = sounding[index].midis[0] === sounding[index - 1].midis[0]
                        && sounding[index - 1].midis[0] === sounding[index - 2].midis[0];
                    if (!same) continue;
                    expect(
                        isAnchor(index - 2) || isAnchor(index - 1) || isAnchor(index),
                    ).toBe(true);
                }
            }
        }
    });

    it('同 seed 的乐句旋律完全一致', () => {
        for (const caseItem of CASES) {
            expect(buildPhrased(caseItem, 13).skeleton)
                .toEqual(buildPhrased(caseItem, 13).skeleton);
        }
    });
});
