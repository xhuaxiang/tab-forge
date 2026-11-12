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
import { groupFlatNotes } from '../../../../core/utils/noteGroup.ts';
import { makeOptions } from './testOptions.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

/** 2 小节 4/4 的合法两音和弦组（E4 + C4，音级不重复） */
function validGroup(groupId = 1, duration: Note['duration'] = 0.5): Note[] {
    return [
        note({ string: 1, fret: 0, duration, chordGroup: groupId }),
        note({ string: 2, fret: 1, duration, chordGroup: groupId }),
    ];
}

/** 用 0.25 的 C 音补满给定时值，保持总时值闭合，隔离被测错误 */
function padToDuration(notes: Note[], target: number): Note[] {
    const result = [...notes];
    let used = groupFlatNotes(result).reduce(
        (sum, group) => sum + group[0].duration, 0,
    );
    while (used + 0.25 <= target + 1e-9) {
        result.push(note({ duration: 0.25 }));
        used += 0.25;
    }
    return result;
}

function errorsFor(notes: Note[], options = validOptions()): string[] {
    return validateNotes(notes, options, LOCAL_IMPROV_CONFIG.playability);
}

function expectErrorIn(
    notes: Note[],
    pattern: RegExp,
    options = validOptions(),
): void {
    expect(errorsFor(notes, options).some(error => pattern.test(error))).toBe(true);
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

    it('合法的击/勾/滑通过，方向、跨度与前音不合格被拒', () => {
        const hammer = validNotes();
        hammer[1].technique = 'hammerOn'; // 0 → 1
        expect(validateNotes(
            hammer, validOptions(), LOCAL_IMPROV_CONFIG.playability,
        )).toEqual([]);

        const pull = validNotes();
        pull[1] = note({ string: 1, fret: 5, duration: 0.25 });
        pull[2] = note({ string: 1, fret: 3, duration: 0.25, technique: 'pullOff' }); // 5 → 3
        expect(validateNotes(
            pull, validOptions(), LOCAL_IMPROV_CONFIG.playability,
        )).toEqual([]);

        const slide = validNotes();
        slide[3].technique = 'slide'; // 5 → 3
        expect(validateNotes(
            slide, validOptions(), LOCAL_IMPROV_CONFIG.playability,
        )).toEqual([]);

        const wrongDirection = validNotes();
        wrongDirection[1].technique = 'pullOff'; // 0 → 1 是上行
        expectError(wrongDirection, /勾弦目标品位应低于前音/);

        const tooFar = [
            note({ fret: 0, duration: 0.25 }),
            note({ fret: 4, duration: 0.25, technique: 'hammerOn' }),
        ];
        expectError(tooFar, /击\/勾弦品位跨度过大/);

        const orphan = [note({ fret: 5, duration: 0.25, technique: 'slide' })];
        expectError(orphan, /连接技法缺少紧邻的同弦前音/);

        const afterRest = [
            { isRest: true, duration: 0.25 } as Note,
            note({ fret: 5, duration: 0.25, technique: 'hammerOn' }),
        ];
        expectError(afterRest, /连接技法缺少紧邻的同弦前音/);

        const otherString = [
            note({ string: 2, fret: 5, duration: 0.25 }),
            note({ string: 1, fret: 7, duration: 0.25, technique: 'hammerOn' }),
        ];
        expectError(otherString, /连接技法必须与前音同弦/);

        const mutedSource = [
            note({ string: 6, fret: 5, duration: 0.25, palmMute: true }),
            note({ string: 6, fret: 3, duration: 0.25, technique: 'pullOff' }),
        ];
        expectError(mutedSource, /前音是闷音\/制音\/断音/);

        const bentSource = [
            note({ fret: 5, duration: 0.25, technique: 'bend', bendAmount: 1 }),
            note({ fret: 7, duration: 0.25, technique: 'hammerOn' }),
        ];
        expectError(bentSource, /前音带推\/揉弦/);

        const tooShort = [
            note({ fret: 5, duration: 0.25 }),
            note({ fret: 7, duration: 0.03125, technique: 'hammerOn' }),
        ];
        expectError(tooShort, /连接技法时值过短/);

        const openStart = [
            note({ fret: 0, duration: 0.25 }),
            note({ fret: 3, duration: 0.25, technique: 'slide' }),
        ];
        expectError(openStart, /滑弦两端都不能是空弦/);

        const openEnd = [
            note({ fret: 5, duration: 0.25 }),
            note({ fret: 0, duration: 0.25, technique: 'slide' }),
        ];
        expectError(openEnd, /滑弦两端都不能是空弦/);

        const noMovement = validNotes();
        noMovement[1] = note({ fret: 0, duration: 0.25, technique: 'hammerOn' }); // 0 → 0
        expectError(noMovement, /击\/勾弦需要品位变化/);
    });

    it('滑弦跨度按技法上限校验，不受跳进上限限制', () => {
        const notes = validNotes();
        notes[3] = note({ fret: 1, duration: 0.25 });
        notes[4] = note({ fret: 7, duration: 0.25, technique: 'slide' });

        const errors = validateNotes(
            notes, validOptions(), LOCAL_IMPROV_CONFIG.playability, 4,
        );
        // 6 个半音超过 middleLimit，但滑弦是连续发声，不算跳进。
        expect(errors.some(error => /跳进/.test(error))).toBe(false);
        expect(errors.some(error => /滑弦/.test(error))).toBe(false);
    });

    it('仍拒绝 targetFret 与本地生成限制外的字段', () => {
        const hammer = validNotes();
        hammer[0] = note({
            string: 1, fret: 5, duration: 0.25,
            technique: 'hammerOn', targetFret: 7,
        });
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

describe('validateNotes（和弦组与奏法）', () => {
    function oneMeasureOptions() {
        return makeOptions({ numMeasures: 1, key: 'C', timeSignature: '4/4' });
    }

    it('合法和弦组通过，单音带 chordGroup 报错', () => {
        expect(errorsFor(padToDuration(validGroup(), 2))).toEqual([]);

        const single = validNotes();
        single[0] = note({ duration: 0.25, chordGroup: 1 });
        expectErrorIn(single, /和弦组/);
    });

    it('和弦组时值只计一次，不误报总时值', () => {
        const notes = [
            ...validGroup(1, 0.5),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            ...validGroup(2, 0.5),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
        ];
        expect(errorsFor(notes)).toEqual([]);
    });

    it('捕获和弦组内时值/力度不一致', () => {
        const durationMismatch = [
            note({ string: 1, fret: 0, duration: 0.5, chordGroup: 1 }),
            note({ string: 2, fret: 1, duration: 0.25, chordGroup: 1 }),
        ];
        expectErrorIn(
            padToDuration(durationMismatch, 2), /和弦组内时值不一致/,
        );

        const dynamicsMismatch = [
            note({
                string: 1, fret: 0, duration: 0.5,
                chordGroup: 1, dynamics: 'accent',
            }),
            note({ string: 2, fret: 1, duration: 0.5, chordGroup: 1 }),
        ];
        expectErrorIn(
            padToDuration(dynamicsMismatch, 2), /和弦组内力度不一致/,
        );
    });

    it('捕获和弦组内同弦、重复音级与声部过多', () => {
        const sameString = [
            note({ string: 1, fret: 0, duration: 0.5, chordGroup: 1 }),
            note({ string: 1, fret: 3, duration: 0.5, chordGroup: 1 }),
        ];
        expectErrorIn(padToDuration(sameString, 2), /同一根弦出现多次/);

        // 1 弦空弦与 2 弦 5 品都是 E
        const duplicatePitch = [
            note({ string: 1, fret: 0, duration: 0.5, chordGroup: 1 }),
            note({ string: 2, fret: 5, duration: 0.5, chordGroup: 1 }),
        ];
        expectErrorIn(padToDuration(duplicatePitch, 2), /重复音级/);

        const tooManyVoices = [
            note({ string: 1, fret: 0, duration: 0.25, chordGroup: 1 }),
            note({ string: 2, fret: 1, duration: 0.25, chordGroup: 1 }),
            note({ string: 3, fret: 0, duration: 0.25, chordGroup: 1 }),
            note({ string: 4, fret: 3, duration: 0.25, chordGroup: 1 }),
        ];
        expectErrorIn(padToDuration(tooManyVoices, 2), /和弦声部过多/);
    });

    it('捕获和弦组的品位/弦号跨度过大', () => {
        const fretSpan = [
            note({ string: 1, fret: 0, duration: 0.5, chordGroup: 1 }),
            note({ string: 2, fret: 8, duration: 0.5, chordGroup: 1 }),
        ];
        expectErrorIn(padToDuration(fretSpan, 2), /和弦品位跨度过大/);

        const stringSpan = [
            note({ string: 1, fret: 5, duration: 0.5, chordGroup: 1 }),
            note({ string: 6, fret: 5, duration: 0.5, chordGroup: 1 }),
        ];
        expectErrorIn(padToDuration(stringSpan, 2), /和弦弦号跨度过大/);
    });

    it('捕获和弦组内单音奏法与组首装饰错误', () => {
        const withArticulation = validGroup();
        withArticulation[1].letRing = true;
        expectErrorIn(
            padToDuration(withArticulation, 2), /和弦组内不能叠加单音奏法/,
        );

        const withTechnique = validGroup();
        withTechnique[1].technique = 'vibrato';
        expectErrorIn(
            padToDuration(withTechnique, 2), /和弦组内不能叠加单音奏法/,
        );

        const nonFirstArpeggio = validGroup();
        nonFirstArpeggio[1].arpeggio = 'up';
        expectErrorIn(
            padToDuration(nonFirstArpeggio, 2), /琶音只能写在和弦组组首/,
        );

        const nonFirstStrum = validGroup();
        nonFirstStrum[1].strum = 'down';
        expectErrorIn(
            padToDuration(nonFirstStrum, 2), /扫弦只能写在和弦组组首/,
        );

        const both = validGroup();
        both[0].arpeggio = 'up';
        both[0].strum = 'down';
        expectErrorIn(padToDuration(both, 2), /琶音与扫弦不能同时使用/);
    });

    it('重复的 chordGroup id 被拒', () => {
        const duplicateId = [
            ...validGroup(1, 0.25),
            note({ duration: 0.25 }),
            ...validGroup(1, 0.25),
            note({ duration: 0.25 }),
        ];
        expectErrorIn(duplicateId, /和弦组 id 1 重复/, oneMeasureOptions());
    });

    it('制音：弦号、最短时值与技法叠加', () => {
        const highString = validNotes();
        highString[0] = note({
            string: 1, fret: 0, duration: 0.25, deadNote: true,
        });
        expectErrorIn(highString, /制音只能用在低音弦/);

        const short = validNotes();
        short[0] = note({
            string: 5, fret: 0, duration: 0.0625, deadNote: true,
        });
        expectErrorIn(short, /制音时值过短/);

        const withTechnique = validNotes();
        withTechnique[0] = note({
            string: 5, fret: 5, duration: 0.25,
            deadNote: true, technique: 'vibrato',
        });
        expectErrorIn(withTechnique, /制音不能与技法叠加/);

        const valid = validNotes();
        valid[0] = note({
            string: 5, fret: 14, duration: 0.25, deadNote: true,
        });
        expect(errorsFor(valid)).toEqual([]);
    });

    it('泛音：三种类型与 harmonicFret 规则', () => {
        const naturalValid = validNotes();
        naturalValid[0] = note({
            string: 1, fret: 12, duration: 0.25, harmonic: 'natural',
        });
        naturalValid[1] = note({ string: 1, fret: 10, duration: 0.25 });
        expect(errorsFor(naturalValid)).toEqual([]);

        const artificialValid = validNotes();
        artificialValid[0] = note({
            string: 1, fret: 5, duration: 0.25,
            harmonic: 'artificial', harmonicFret: 12,
        });
        artificialValid[1] = note({ string: 1, fret: 3, duration: 0.25 });
        expect(errorsFor(artificialValid)).toEqual([]);

        const pinchValid = validNotes();
        pinchValid[0] = note({
            string: 5, fret: 19, duration: 0.25,
            harmonic: 'pinch', harmonicFret: 12,
        });
        expect(errorsFor(pinchValid)).toEqual([]);

        const naturalWithFret = validNotes();
        naturalWithFret[0] = note({
            string: 1, fret: 12, duration: 0.25,
            harmonic: 'natural', harmonicFret: 12,
        });
        expectErrorIn(naturalWithFret, /自然泛音不应带 harmonicFret/);

        const naturalBadNode = validNotes();
        naturalBadNode[0] = note({
            string: 1, fret: 7, duration: 0.25, harmonic: 'natural',
        });
        expectErrorIn(naturalBadNode, /自然泛音节点非法/);

        const artificialOpen = validNotes();
        artificialOpen[0] = note({
            string: 1, fret: 0, duration: 0.25,
            harmonic: 'artificial', harmonicFret: 12,
        });
        expectErrorIn(artificialOpen, /人工\/捏弦泛音必须有按弦品位/);

        const artificialBadFret = validNotes();
        artificialBadFret[0] = note({
            string: 1, fret: 5, duration: 0.25,
            harmonic: 'artificial', harmonicFret: 7,
        });
        expectErrorIn(artificialBadFret, /泛音触弦品位非法/);

        const pinchHigh = validNotes();
        pinchHigh[0] = note({
            string: 1, fret: 5, duration: 0.25,
            harmonic: 'pinch', harmonicFret: 12,
        });
        expectErrorIn(pinchHigh, /捏弦泛音只能用在低音弦/);

        const short = validNotes();
        short[0] = note({
            string: 1, fret: 12, duration: 0.125, harmonic: 'natural',
        });
        expectErrorIn(short, /泛音时值过短/);

        const withTechnique = validNotes();
        withTechnique[0] = note({
            string: 1, fret: 12, duration: 0.25,
            harmonic: 'natural', technique: 'vibrato',
        });
        expectErrorIn(withTechnique, /泛音不能与技法叠加/);

        const withDead = validNotes();
        withDead[0] = note({
            string: 6, fret: 12, duration: 0.25,
            harmonic: 'natural', deadNote: true,
        });
        expectErrorIn(withDead, /泛音不能与制音\/闷音叠加/);

        const orphanFret = validNotes();
        orphanFret[0] = note({
            string: 1, fret: 5, duration: 0.25, harmonicFret: 12,
        });
        expectErrorIn(orphanFret, /没有泛音却带 harmonicFret/);
    });

    it('断音与延音的时值和叠加禁则', () => {
        const shortStaccato = validNotes();
        shortStaccato[0] = note({
            string: 1, fret: 5, duration: 0.03125, staccato: true,
        });
        expectErrorIn(shortStaccato, /断音时值过短/);

        const staccatoWithTechnique = validNotes();
        staccatoWithTechnique[0] = note({
            string: 1, fret: 5, duration: 0.25,
            staccato: true, technique: 'vibrato',
        });
        expectErrorIn(staccatoWithTechnique, /断音不能与技法叠加/);

        const shortLetRing = validNotes();
        shortLetRing[0] = note({
            string: 1, fret: 5, duration: 0.125, letRing: true,
        });
        expectErrorIn(shortLetRing, /延音时值过短/);

        // 断音已缩短发声，letRing 不再按最短时值报错
        const staccatoLetRing = validNotes();
        staccatoLetRing[0] = note({
            string: 1, fret: 5, duration: 0.0625,
            staccato: true, letRing: true,
        });
        expect(errorsFor(staccatoLetRing)
            .some(error => /延音时值过短/.test(error))).toBe(false);

        const letRingWithTechnique = validNotes();
        letRingWithTechnique[0] = note({
            string: 1, fret: 5, duration: 0.25,
            letRing: true, technique: 'vibrato',
        });
        expectErrorIn(letRingWithTechnique, /延音不能与技法叠加/);

        const letRingWithPalmMute = validNotes();
        letRingWithPalmMute[0] = note({
            string: 6, fret: 5, duration: 0.25,
            letRing: true, palmMute: true,
        });
        expectErrorIn(letRingWithPalmMute, /延音不能与制音\/闷音叠加/);
    });

    it('手掌闷音不能与制音/泛音/延音叠加', () => {
        const withDead = validNotes();
        withDead[0] = note({
            string: 6, fret: 5, duration: 0.25,
            palmMute: true, deadNote: true,
        });
        expectErrorIn(withDead, /手掌闷音不能与制音\/泛音\/延音叠加/);

        const withHarmonic = validNotes();
        withHarmonic[0] = note({
            string: 6, fret: 12, duration: 0.25,
            palmMute: true, harmonic: 'natural',
        });
        expectErrorIn(withHarmonic, /手掌闷音不能与制音\/泛音\/延音叠加/);

        const withLetRing = validNotes();
        withLetRing[0] = note({
            string: 6, fret: 5, duration: 0.25,
            palmMute: true, letRing: true,
        });
        expectErrorIn(withLetRing, /手掌闷音不能与制音\/泛音\/延音叠加/);
    });

    it('连接技法的目标带奏法时被拒', () => {
        const deadTarget = validNotes();
        deadTarget[0] = note({ string: 6, fret: 5, duration: 0.25 });
        deadTarget[1] = note({
            string: 6, fret: 7, duration: 0.25,
            technique: 'hammerOn', deadNote: true,
        });
        expectErrorIn(deadTarget, /连接技法不能用于制音/);

        const harmonicTarget = validNotes();
        harmonicTarget[0] = note({ string: 1, fret: 5, duration: 0.25 });
        harmonicTarget[1] = note({
            string: 1, fret: 7, duration: 0.25,
            technique: 'hammerOn', harmonic: 'artificial', harmonicFret: 12,
        });
        expectErrorIn(harmonicTarget, /连接技法不能用于泛音/);

        const staccatoTarget = validNotes();
        staccatoTarget[0] = note({ string: 1, fret: 5, duration: 0.25 });
        staccatoTarget[1] = note({
            string: 1, fret: 7, duration: 0.25,
            technique: 'hammerOn', staccato: true,
        });
        expectErrorIn(staccatoTarget, /连接技法不能用于断音/);

        const letRingTarget = validNotes();
        letRingTarget[0] = note({ string: 1, fret: 5, duration: 0.25 });
        letRingTarget[1] = note({
            string: 1, fret: 7, duration: 0.25,
            technique: 'hammerOn', letRing: true,
        });
        expectErrorIn(letRingTarget, /连接技法不能用于延音/);

        const palmMuteTarget = validNotes();
        palmMuteTarget[0] = note({ string: 6, fret: 5, duration: 0.25 });
        palmMuteTarget[1] = note({
            string: 6, fret: 7, duration: 0.25,
            technique: 'hammerOn', palmMute: true,
        });
        expectErrorIn(palmMuteTarget, /连接技法不能用于闷音/);
    });

    it('泛音前音不能作为连接源', () => {
        const notes = validNotes();
        notes[0] = note({
            string: 1, fret: 12, duration: 0.25, harmonic: 'natural',
        });
        notes[1] = note({
            string: 1, fret: 10, duration: 0.25, technique: 'pullOff',
        });
        expectErrorIn(notes, /前音是泛音/);
    });

    it('连接技法的前一组必须是一般单音', () => {
        const notes = [
            ...validGroup(1, 0.5),
            note({ string: 1, fret: 3, duration: 0.25, technique: 'hammerOn' }),
            note({ string: 1, fret: 0, duration: 0.25 }),
        ];
        expectErrorIn(notes, /前一组必须是单音/, oneMeasureOptions());
    });

    it('和弦组跳进看最高声部，低音不参与', () => {
        const oneMeasure = oneMeasureOptions();

        const highLeap = [
            note({ string: 1, fret: 12, duration: 0.25 }),
            note({ string: 1, fret: 20, duration: 0.25, chordGroup: 1 }),
            note({ string: 2, fret: 3, duration: 0.25, chordGroup: 1 }),
            note({ string: 1, fret: 20, duration: 0.5 }),
        ];
        expectErrorIn(highLeap, /跳进 8/, oneMeasure);

        const lowVoiceFar = [
            note({ string: 1, fret: 5, duration: 0.25 }),
            note({ string: 1, fret: 7, duration: 0.25, chordGroup: 1 }),
            note({ string: 5, fret: 12, duration: 0.25, chordGroup: 1 }),
            note({ string: 1, fret: 7, duration: 0.5 }),
        ];
        expect(errorsFor(lowVoiceFar, oneMeasure)
            .some(error => /跳进/.test(error))).toBe(false);
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
