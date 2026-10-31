/**
 * harmony — 和弦音、调内级数、每小节音池与和声校验测试。
 */

import { describe, it, expect } from 'vitest';
import type { Note } from '../../../../core/types/index.ts';
import {
    LOCAL_IMPROV_CONFIG,
    LOCAL_PROGRESSIONS,
} from '../../../../core/config.ts';
import {
    LOCAL_STYLES,
    SCALE_TYPES,
    type ChordSpec,
    type Progression,
    type ScaleType,
} from '../../../../core/types/improv.ts';
import {
    generateLocalImprovisation,
    resolveLocalImprovOptions,
} from '../../../../core/utils/improv/generate.ts';
import {
    buildHarmonyPlan,
    chordTonePitchClasses,
    diatonicChord,
    normalizeProgression,
} from '../../../../core/utils/improv/harmony.ts';
import { buildSkeleton } from '../../../../core/utils/improv/melody.ts';
import { fretToMidi, pitchClassOf } from '../../../../core/utils/improv/pitch.ts';
import { createRng } from '../../../../core/utils/improv/random.ts';
import {
    buildRhythmPlan,
    classifySlotRole,
} from '../../../../core/utils/improv/rhythm.ts';
import { validateNotes } from '../../../../core/utils/improv/validate.ts';
import { makeOptions } from './testOptions.ts';

function note(
    string: number,
    fret: number,
    duration: Note['duration'] = 0.25,
): Note {
    return { string, fret, duration };
}

describe('chordTonePitchClasses', () => {
    it('按根音与质量计算和弦音，结果升序去重', () => {
        expect(chordTonePitchClasses({
            rootPitchClass: 0, quality: 'major',
        })).toEqual([0, 4, 7]);
        expect(chordTonePitchClasses({
            rootPitchClass: 9, quality: 'minor',
        })).toEqual([0, 4, 9]);
        expect(chordTonePitchClasses({
            rootPitchClass: 7, quality: 'dominant7',
        })).toEqual([2, 5, 7, 11]);
        expect(chordTonePitchClasses({
            rootPitchClass: 11, quality: 'halfDiminished7',
        })).toEqual([2, 5, 9, 11]);
    });
});

describe('diatonicChord', () => {
    it('C 大调七个级数的三和弦质量与和弦音正确', () => {
        const expected: Array<{
            degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
            quality: string;
            tones: number[];
        }> = [
            { degree: 1, quality: 'major', tones: [0, 4, 7] },
            { degree: 2, quality: 'minor', tones: [2, 5, 9] },
            { degree: 3, quality: 'minor', tones: [4, 7, 11] },
            { degree: 4, quality: 'major', tones: [0, 5, 9] },
            { degree: 5, quality: 'major', tones: [2, 7, 11] },
            { degree: 6, quality: 'minor', tones: [0, 4, 9] },
            { degree: 7, quality: 'diminished', tones: [2, 5, 11] },
        ];

        for (const item of expected) {
            const chord = diatonicChord(0, 'Major (Ionian)', item.degree);
            expect(chord).not.toBeNull();
            expect(chord?.quality).toBe(item.quality);
            expect(chordTonePitchClasses(chord!)).toEqual(item.tones);
        }
    });

    it('和声小调的 III 级是增三和弦，五声/六声音阶返回 null', () => {
        const augmented = diatonicChord(
            9, 'Harmonic Minor', 3,
        );
        expect(augmented).toEqual({
            rootPitchClass: 0,
            quality: 'augmented',
        });
        expect(diatonicChord(9, 'Blues', 2)).toBeNull();
        expect(diatonicChord(0, 'Pentatonic Major', 5)).toBeNull();
    });
});

describe('resolveLocalImprovOptions 与进行', () => {
    it('合法进行原样进入解析结果，缺省/非法进行回落 I 级', () => {
        expect(resolveLocalImprovOptions({ progression: [2, 5, 1] }).progression)
            .toEqual([2, 5, 1]);
        expect(resolveLocalImprovOptions().progression).toEqual([1]);
        expect(resolveLocalImprovOptions({
            progression: [9] as unknown as Progression,
        }).progression).toEqual([1]);
    });
});

describe('normalizeProgression', () => {
    it('空值/空数组回落到 I 级', () => {
        expect(normalizeProgression(undefined)).toEqual([1]);
        expect(normalizeProgression([])).toEqual([1]);
        expect(normalizeProgression('2-5-1')).toEqual([1]);
    });

    it('合法级数保留，非法项整组回落', () => {
        expect(normalizeProgression([2, 5, 1])).toEqual([2, 5, 1]);
        expect(normalizeProgression([0, 5, 1])).toEqual([1]);
        expect(normalizeProgression([2, 8, 1])).toEqual([1]);
        expect(normalizeProgression([2, { rootPitchClass: 99, quality: 'major' }]))
            .toEqual([1]);
    });

    it('显式和弦被克隆，避免调用方后续修改', () => {
        const chord: ChordSpec = { rootPitchClass: 2, quality: 'minor7' };
        const result = normalizeProgression([chord]);
        expect(result).toEqual([chord]);
        expect(result[0]).not.toBe(chord);
    });
});

describe('buildHarmonyPlan', () => {
    it('ii-V-I 在 4 小节里铺成 ii-V-I-I', () => {
        const options = makeOptions({
            numMeasures: 4,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [2, 5, 1],
        });
        const plan = buildHarmonyPlan(options);

        expect(plan.map(measure => measure.measureIndex)).toEqual([0, 1, 2, 3]);
        expect(plan.map(measure => measure.segments[0].chord.rootPitchClass))
            .toEqual([2, 7, 0, 0]);
        expect(plan.map(measure => measure.segments[0].chord.quality))
            .toEqual(['minor', 'major', 'major', 'major']);
        expect(plan.every(measure => measure.segments[0].start === 0)).toBe(true);
        expect(plan.every(measure => measure.segments[0].duration === 1)).toBe(true);
    });

    it('每小节输出和弦音、可用音池、经过音与 avoid note', () => {
        const options = makeOptions({
            numMeasures: 4,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [2, 5, 1],
        });
        const plan = buildHarmonyPlan(options);

        expect(plan[2].segments[0].pool).toEqual({
            chordPitchClasses: [0, 4, 7],
            availablePitchClasses: [0, 2, 4, 5, 7, 9, 11],
            passingPitchClasses: [2, 5, 9, 11],
            avoidPitchClasses: [5],
        });
        expect(plan[0].segments[0].pool.avoidPitchClasses).toEqual([]);
        expect(plan[1].segments[0].pool.avoidPitchClasses).toEqual([0]);
    });

    it('小节数少于进行长度时保留进行收尾', () => {
        const options = makeOptions({
            numMeasures: 2,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [2, 5, 1],
        });
        expect(buildHarmonyPlan(options)
            .map(measure => measure.segments[0].chord.rootPitchClass))
            .toEqual([7, 0]);
    });

    it('小节数多于进行长度时循环，并强制最后一小节收尾', () => {
        const options = makeOptions({
            numMeasures: 5,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [2, 5, 1],
        });
        expect(buildHarmonyPlan(options)
            .map(measure => measure.segments[0].chord.rootPitchClass))
            .toEqual([2, 7, 0, 2, 0]);
    });

    it('显式和弦可以引入调外和弦音', () => {
        const options = makeOptions({
            numMeasures: 1,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [{ rootPitchClass: 4, quality: 'dominant7' }],
        });
        const segment = buildHarmonyPlan(options)[0].segments[0];

        expect(chordTonePitchClasses(segment.chord)).toEqual([2, 4, 8, 11]);
        expect(segment.pool.availablePitchClasses)
            .toEqual([0, 2, 4, 5, 7, 8, 9, 11]);
        expect(segment.pool.avoidPitchClasses).toEqual([0, 5, 9]);
    });

    it('五声/六声音阶的级数进行回落到主和弦', () => {
        for (const scaleType of ['Blues', 'Pentatonic Major', 'Pentatonic Minor'] as const) {
            const options = makeOptions({
                numMeasures: 2,
                key: 'A',
                scaleType,
                progression: [2, 5, 1],
            });
            const plan = buildHarmonyPlan(options);
            for (const measure of plan) {
                expect(measure.segments[0].chord.rootPitchClass)
                    .toBe(options.tonicPitchClass);
            }
        }
    });
});

describe('buildSkeleton 与和声约束', () => {
    it('强拍、句尾落当前和弦音，弱拍长音避开 avoid note', () => {
        const options = makeOptions({
            numMeasures: 3,
            key: 'C',
            scaleType: 'Major (Ionian)',
            style: 'Folk',
            density: '中',
            progression: [2, 5, 1],
            seed: 4,
        });
        const style = LOCAL_IMPROV_CONFIG.styleProfiles[options.style];
        const rhythm = buildRhythmPlan(
            options,
            LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
            style,
            createRng(options.seed),
        );
        const harmony = buildHarmonyPlan(options);
        const skeleton = buildSkeleton(
            rhythm, options, style, LOCAL_IMPROV_CONFIG.playability,
            createRng(options.seed + 1), harmony,
        );

        const finalIndex = skeleton.reduce(
            (last, slot, index) => slot.isRest ? last : index,
            -1,
        );
        skeleton.forEach((slot, index) => {
            if (slot.isRest || index === finalIndex) return;
            const pool = harmony[slot.measureIndex].segments[0].pool;
            const pitchClass = pitchClassOf(slot.midis[0]);

            if (slot.role === 'strong') {
                expect(pool.chordPitchClasses).toContain(pitchClass);
            }
            if (slot.role !== 'passing') {
                expect(
                    pool.avoidPitchClasses.includes(pitchClass)
                    && !pool.chordPitchClasses.includes(pitchClass),
                ).toBe(false);
            }
        });

        for (const measure of harmony) {
            const sounding = skeleton.filter(slot =>
                slot.measureIndex === measure.measureIndex && !slot.isRest);
            const last = sounding[sounding.length - 1];
            if (measure.measureIndex < harmony.length - 1) {
                expect(measure.segments[0].pool.chordPitchClasses)
                    .toContain(pitchClassOf(last.midis[0]));
            }
        }
    });
});

describe('validateNotes 与和声', () => {
    it('强拍不是当前和弦音会报错', () => {
        const options = makeOptions({
            numMeasures: 1,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [2],
        });
        const harmony = buildHarmonyPlan(options);
        // Dm 和弦下，E 是调内音但不是和弦音。
        const notes = [
            note(4, 2), note(4, 3), note(3, 2), note(4, 0),
        ];

        expect(validateNotes(
            notes, options, LOCAL_IMPROV_CONFIG.playability,
            LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones, harmony,
        ).some(error => /强拍但不在当前和弦音/.test(error))).toBe(true);
    });

    it('长音 avoid note 会报错，纯和弦音通过', () => {
        const options = makeOptions({
            numMeasures: 1,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [1],
        });
        const harmony = buildHarmonyPlan(options);

        const valid = [
            note(5, 3), note(4, 3), note(3, 0), note(5, 3),
        ];
        // C3 → F3（弱拍长音 avoid）→ G3 → C3
        expect(validateNotes(
            valid, options, LOCAL_IMPROV_CONFIG.playability,
            LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones, harmony,
        ).some(error => /avoid note/.test(error))).toBe(true);

        const chordTones = [
            note(5, 3), note(4, 2), note(3, 0), note(5, 3),
        ];
        // C3 → E3 → G3 → C3
        expect(validateNotes(
            chordTones, options, LOCAL_IMPROV_CONFIG.playability,
            LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones, harmony,
        )).toEqual([]);
    });

    it('显式调外和弦音在可用音池内可以通过', () => {
        const options = makeOptions({
            numMeasures: 1,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [{ rootPitchClass: 4, quality: 'dominant7' }],
        });
        const harmony = buildHarmonyPlan(options);
        // E7 下的 G#3 / E3 / B3 / E4；G# 不在 C 大调内，但属于 E7。
        const notes = [
            note(3, 1), note(4, 2), note(3, 4), note(1, 0),
        ];

        expect(validateNotes(
            notes, options, LOCAL_IMPROV_CONFIG.playability,
            LOCAL_IMPROV_CONFIG.playability.maxLeapSemitones, harmony,
        )).toEqual([]);
    });
});

describe('generateLocalImprovisation 与和声', () => {
    it('结果带每小节和声，强拍落当前和弦音', () => {
        const result = generateLocalImprovisation({
            numMeasures: 4,
            key: 'C',
            scaleType: 'Major (Ionian)',
            style: 'Folk',
            density: '中',
            progression: [2, 5, 1],
            seed: 9,
        });
        const capacity = 1;

        expect(result.harmony).toHaveLength(4);
        expect(result.harmony.map(measure =>
            measure.segments[0].chord.rootPitchClass,
        )).toEqual([2, 7, 0, 0]);

        const lastSounding = result.notes.reduce(
            (last, noteItem, index) => noteItem.isRest ? last : index,
            -1,
        );
        let total = 0;
        result.notes.forEach((noteItem, index) => {
            if (!noteItem.isRest && index !== lastSounding
                && noteItem.string !== undefined && noteItem.fret !== undefined) {
                const measureIndex = Math.floor(total / capacity + 1e-9);
                const offset = total - measureIndex * capacity;
                const role = classifySlotRole(
                    offset, noteItem.duration, result.options.timeSignature,
                );
                const midi = fretToMidi(
                    result.options.tuning, noteItem.string, noteItem.fret,
                );
                const pool = result.harmony[measureIndex].segments[0].pool;
                expect(
                    role === 'strong'
                    || !pool.avoidPitchClasses.includes(pitchClassOf(midi)),
                ).toBe(true);
                if (role === 'strong') {
                    expect(pool.chordPitchClasses).toContain(pitchClassOf(midi));
                }
            }
            total += noteItem.duration;
        });
    });

    it('所有风格 × 音阶 × 多 seed 都能带进行生成', () => {
        for (const style of LOCAL_STYLES) {
            for (const scaleType of SCALE_TYPES as readonly ScaleType[]) {
                for (let seed = 1; seed <= 3; seed++) {
                    expect(() => generateLocalImprovisation({
                        numMeasures: 2,
                        key: 'C',
                        scaleType,
                        style,
                        progression: [2, 5, 1],
                        seed,
                    })).not.toThrow();
                }
            }
        }
    });

    it('显式调外和弦进行也能生成', () => {
        expect(() => generateLocalImprovisation({
            numMeasures: 2,
            key: 'C',
            scaleType: 'Major (Ionian)',
            style: 'Folk',
            progression: [{ rootPitchClass: 4, quality: 'dominant7' }],
            seed: 3,
        })).not.toThrow();
    });

    it('显式调外和弦的 avoid 吸附不会制造超限跳进', () => {
        // 回归：avoid 吸附曾围绕候选音而不是上一个音搜索，
        // 可能让落点离上一个音达到两倍 maxLeap。
        const chords: ChordSpec[] = [
            { rootPitchClass: 1, quality: 'diminished7' },
            { rootPitchClass: 6, quality: 'augmented' },
            { rootPitchClass: 3, quality: 'major7' },
            { rootPitchClass: 10, quality: 'halfDiminished7' },
            { rootPitchClass: 11, quality: 'minor' },
            { rootPitchClass: 4, quality: 'dominant7' },
        ];
        for (const chord of chords) {
            for (let seed = 1; seed <= 10; seed++) {
                expect(() => generateLocalImprovisation({
                    numMeasures: 4,
                    key: 'C',
                    scaleType: 'Natural Minor (Aeolian)',
                    style: 'Blues',
                    density: '低',
                    timeSignature: '4/4',
                    progression: [chord],
                    seed,
                })).not.toThrow();
            }
        }
    });

    it('所有预设进行 × 拍号 × 短/长小节都能生成', () => {
        for (const option of LOCAL_PROGRESSIONS) {
            for (const timeSignature of LOCAL_IMPROV_CONFIG.timeSignatures) {
                for (const numMeasures of [2, 8]) {
                    for (const seed of [1, 2]) {
                        expect(() => generateLocalImprovisation({
                            numMeasures,
                            key: 'C',
                            scaleType: 'Major (Ionian)',
                            style: 'Folk',
                            timeSignature,
                            progression: option.steps,
                            seed,
                        })).not.toThrow();
                    }
                }
            }
        }
    });
});
