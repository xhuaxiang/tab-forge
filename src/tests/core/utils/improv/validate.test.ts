/**
 * validate — 生成结果的边界守门测试。
 */

import { describe, it, expect } from 'vitest';
import type { Note } from '../../../../core/types/index.ts';
import type { RhythmMeasure } from '../../../../core/types/improv.ts';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import { buildPhrasePlan } from '../../../../core/utils/improv/phrase.ts';
import { createRng } from '../../../../core/utils/improv/random.ts';
import { validateNotes, validatePlan } from '../../../../core/utils/improv/validate.ts';
import { makeOptions } from './testOptions.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

/** 2 小节 4/4，8 个四分音符，全部在 C 大调内 */
function validNotes(): Note[] {
    return [0, 1, 3, 5, 7, 8, 10, 12].map(fret =>
        note({ string: 1, fret, duration: 0.25 }));
}

function validOptions() {
    return makeOptions({ numMeasures: 2, key: 'C', timeSignature: '4/4' });
}

function expectError(notes: Note[], pattern: RegExp): void {
    const errors = validateNotes(
        notes, validOptions(), LOCAL_IMPROV_CONFIG.playability,
    );
    expect(errors.some(error => pattern.test(error))).toBe(true);
}

describe('validateNotes', () => {
    it('合法输出返回空数组', () => {
        expect(validateNotes(
            validNotes(), validOptions(), LOCAL_IMPROV_CONFIG.playability,
        )).toEqual([]);
    });

    it('捕获非法时值、调外音、弦号、品位', () => {
        const invalidDuration = validNotes();
        invalidDuration[0] = note({ string: 1, fret: 0, duration: 0.3 as Note['duration'] });
        expectError(invalidDuration, /时值非法/);

        const outOfScale = validNotes();
        outOfScale[0] = note({ string: 1, fret: 2, duration: 0.25 });
        expectError(outOfScale, /不在调内/);

        const badString = validNotes();
        badString[0] = note({ string: 7, fret: 0, duration: 0.25 });
        expectError(badString, /弦号非法/);

        const badFret = validNotes();
        badFret[0] = note({ string: 1, fret: 25, duration: 0.25 });
        expectError(badFret, /品位非法/);
    });

    it('捕获 v1 不支持的技法与字段', () => {
        const hammer = validNotes();
        hammer[0] = note({
            string: 1, fret: 5, duration: 0.25,
            technique: 'hammerOn', targetFret: 7,
        });
        expectError(hammer, /不支持的技法/);
        expectError(hammer, /targetFret/);

        const chord = validNotes();
        chord[0] = note({ string: 1, fret: 0, duration: 0.25, chordGroup: 1 });
        expectError(chord, /和弦组/);
    });

    it('捕获推弦/揉弦/闷音的边界错误', () => {
        const badBendAmount = validNotes();
        badBendAmount[0] = note({
            string: 1, fret: 5, duration: 0.25,
            technique: 'bend', bendAmount: 0.3,
        });
        expectError(badBendAmount, /推弦幅度非法/);

        const openBend = validNotes();
        openBend[0] = note({
            string: 1, fret: 0, duration: 0.25,
            technique: 'bend', bendAmount: 1,
        });
        expectError(openBend, /空弦不能推弦/);

        const shortBend = validNotes();
        shortBend[0] = note({
            string: 1, fret: 5, duration: 0.0625,
            technique: 'bend', bendAmount: 1,
        });
        expectError(shortBend, /推弦时值过短/);

        const shortRelease = validNotes();
        shortRelease[0] = note({
            string: 1, fret: 5, duration: 0.125,
            technique: 'bend', bendAmount: 1, bendRelease: true,
        });
        expectError(shortRelease, /推弦释放时值过短/);

        const shortVibrato = validNotes();
        shortVibrato[0] = note({
            string: 1, fret: 5, duration: 0.125,
            technique: 'vibrato',
        });
        expectError(shortVibrato, /揉弦时值过短/);

        const highPalmMute = validNotes();
        highPalmMute[0] = note({
            string: 1, fret: 5, duration: 0.25, palmMute: true,
        });
        expectError(highPalmMute, /低音弦/);

        const palmMuteWithTechnique = validNotes();
        palmMuteWithTechnique[0] = note({
            string: 6, fret: 0, duration: 0.25,
            palmMute: true, technique: 'bend', bendAmount: 1,
        });
        expectError(palmMuteWithTechnique, /不能与技法叠加/);
    });

    it('捕获休止符带演奏字段与总时值不闭合', () => {
        const restWithString = validNotes();
        restWithString[0] = { isRest: true, duration: 0.25, string: 1 } as Note;
        expectError(restWithString, /休止符/);

        const wrongTotal = validNotes();
        wrongTotal[0] = note({ string: 1, fret: 0, duration: 0.5 });
        expectError(wrongTotal, /总时值/);
    });

    it('休止符带任意演奏字段都报错', () => {
        const extras: Partial<Note>[] = [
            { string: 1 },
            { fret: 0 },
            { technique: 'bend' },
            { targetFret: 5 },
            { bendAmount: 1 },
            { bendRelease: true },
            { palmMute: true },
            { deadNote: true },
            { letRing: true },
            { staccato: true },
            { harmonic: 'natural' },
            { harmonicFret: 12 },
            { tieToNext: true },
            { chordGroup: 1 },
            { chordName: 'C' },
            { arpeggio: 'up' },
            { strum: 'down' },
            { dynamics: 'accent' },
        ];
        for (const extra of extras) {
            const notes = validNotes();
            notes[0] = { isRest: true, duration: 0.25, ...extra } as Note;
            expectError(notes, /休止符/);
        }
    });

    it('非有限或非正时值只报错，不阻塞校验', () => {
        const infinite = validNotes();
        infinite[0] = note({ string: 1, fret: 0, duration: Infinity as Note['duration'] });
        expect(() => validateNotes(
            infinite, validOptions(), LOCAL_IMPROV_CONFIG.playability,
        )).not.toThrow();
        expectError(infinite, /时值非法/);

        const notANumber = validNotes();
        notANumber[0] = note({ string: 1, fret: 0, duration: NaN as Note['duration'] });
        expect(() => validateNotes(
            notANumber, validOptions(), LOCAL_IMPROV_CONFIG.playability,
        )).not.toThrow();
        expectError(notANumber, /时值非法/);

        const negative = validNotes();
        negative[0] = note({
            string: 1, fret: 0, duration: -0.25 as unknown as Note['duration'],
        });
        expectError(negative, /时值非法/);
    });

    it('段落中间按风格上限判跳进，最后一个音放宽到可演奏上限', () => {
        const middleLeap = validNotes();
        middleLeap[1] = note({ string: 1, fret: 5, duration: 0.25 });
        expect(validateNotes(
            middleLeap, validOptions(), LOCAL_IMPROV_CONFIG.playability, 4,
        ).some(error => /跳进/.test(error))).toBe(true);

        // 最后一个音从 10 品跳到 17 品（7 个半音），中段会超限，收尾允许。
        const finalLeap = validNotes();
        finalLeap[finalLeap.length - 1] = note({ string: 1, fret: 17, duration: 0.25 });
        const finalErrors = validateNotes(
            finalLeap, validOptions(), LOCAL_IMPROV_CONFIG.playability, 4,
        );
        expect(finalErrors.some(error => /跳进/.test(error))).toBe(false);

        const middleTooFar = validNotes();
        middleTooFar[6] = note({ string: 1, fret: 17, duration: 0.25 });
        expect(validateNotes(
            middleTooFar, validOptions(), LOCAL_IMPROV_CONFIG.playability, 4,
        ).some(error => /跳进/.test(error))).toBe(true);
    });

    it('捕获超过上限的相邻音程', () => {
        const leap = validNotes();
        leap[1] = note({ string: 1, fret: 12, duration: 0.25 });
        expectError(leap, /跳进/);
    });

    it('锁定把位时只对收尾音豁免跳进，中间音仍按放宽上限校验', () => {
        const playability = LOCAL_IMPROV_CONFIG.playability;
        const locked = makeOptions({
            numMeasures: 2,
            key: 'C',
            fretRange: { min: 10, max: 12 },
        });
        const notes = Array.from({ length: 8 }, () =>
            note({ string: 1, fret: 10, duration: 0.25 }));

        // 收尾落到 10-12 品内唯一的主音 C（60），与上一个音 74 差 14。
        const finalFar = [...notes];
        finalFar[7] = note({ string: 4, fret: 10, duration: 0.25 });
        expect(validateNotes(finalFar, locked, playability)
            .some(error => /跳进/.test(error))).toBe(false);

        // 同样的跳进放在中间音上仍然超限（锁定放宽上限为 12）。
        const middleFar = [...notes];
        middleFar[6] = note({ string: 4, fret: 10, duration: 0.25 });
        expect(validateNotes(middleFar, locked, playability)
            .some(error => /跳进/.test(error))).toBe(true);

        // 全指板范围不算「锁定窄窗口」，不触发收尾豁免。
        const wide = makeOptions({
            numMeasures: 2,
            key: 'C',
            fretRange: { min: 0, max: 24 },
        });
        expect(validateNotes(finalFar, wide, playability)
            .some(error => /跳进/.test(error))).toBe(true);
    });

    it('句首换把放宽到 maxPhraseLeapSemitones，且只放宽第一个发音', () => {
        const leap = validNotes();
        leap[4] = note({ string: 1, fret: 14, duration: 0.25 });
        leap[5] = note({ string: 1, fret: 3, duration: 0.25 });

        // 没有乐句信息时，第 2 小节首音仍按风格上限校验。
        expect(validateNotes(
            leap, validOptions(), LOCAL_IMPROV_CONFIG.playability, 4,
        ).some(error => /跳进/.test(error))).toBe(true);

        const options = validOptions();
        const base = LOCAL_IMPROV_CONFIG.styleProfiles.Jazz;
        const style = {
            ...base,
            phrase: { ...base.phrase, measures: 1 },
        };
        const phrases = buildPhrasePlan(
            options, style, LOCAL_IMPROV_CONFIG.playability, createRng(1),
        );
        expect(phrases[1].startMeasure).toBe(1);
        const errors = validateNotes(
            leap, options, LOCAL_IMPROV_CONFIG.playability, 4,
            undefined, phrases,
        );
        // 第 5 个音是句首（5→14 共 9 个半音，放宽后允许）
        expect(errors.some(error => error.includes('第 5 个音符跳进'))).toBe(false);
        // 第 6 个音不再放宽（14→3 共 11 个半音，超过 middleLimit=4）
        expect(errors.some(error => error.includes('第 6 个音符跳进 11'))).toBe(true);
    });
});

describe('validatePlan', () => {
    function plan(overrides: Partial<RhythmMeasure> = {}): RhythmMeasure[] {
        return [{
            index: 0,
            capacity: 1,
            slots: [
                { duration: 0.25, isRest: false, role: 'strong' },
                { duration: 0.25, isRest: false, role: 'weak' },
                { duration: 0.25, isRest: false, role: 'weak' },
                { duration: 0.25, isRest: false, role: 'weak' },
            ],
            ...overrides,
        }];
    }

    it('合法计划返回空数组', () => {
        expect(validatePlan(plan(), makeOptions({ numMeasures: 1 }))).toEqual([]);
    });

    it('捕获未闭合、全休止、小节数错误', () => {
        const wrongSum = plan({
            slots: [
                { duration: 0.25, isRest: false, role: 'strong' },
                { duration: 0.25, isRest: false, role: 'weak' },
            ],
        });
        expect(validatePlan(wrongSum, makeOptions({ numMeasures: 1 }))
            .some(error => /未闭合/.test(error))).toBe(true);

        const allRest = plan({
            slots: [
                { duration: 0.5, isRest: true, role: 'strong' },
                { duration: 0.5, isRest: true, role: 'weak' },
            ],
        });
        expect(validatePlan(allRest, makeOptions({ numMeasures: 1 }))
            .some(error => /全是休止符/.test(error))).toBe(true);

        expect(validatePlan(plan(), makeOptions({ numMeasures: 2 }))
            .some(error => /小节数不匹配/.test(error))).toBe(true);
    });

    it('捕获低于密度下限的发音数', () => {
        const sparse = plan({
            slots: [
                { duration: 0.5, isRest: false, role: 'strong' },
                { duration: 0.5, isRest: true, role: 'weak' },
            ],
        });
        expect(validatePlan(sparse, makeOptions({ numMeasures: 1 }), 2)
            .some(error => /少于密度下限/.test(error))).toBe(true);
        expect(validatePlan(plan(), makeOptions({ numMeasures: 1 }), 4)).toEqual([]);
    });
});
