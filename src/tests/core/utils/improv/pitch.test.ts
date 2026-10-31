/**
 * pitch — 调性、音阶与指板换算测试。
 */

import { describe, it, expect } from 'vitest';
import { STANDARD_TUNING, TUNING_PRESETS } from '../../../../core/types/index.ts';
import {
    fretToMidi,
    isInScale,
    midiToFretPositions,
    nearestMidiWithPitchClasses,
    openStringMidis,
    parseKey,
    playableMidiRange,
    scaleMidisInRange,
    scalePitchClasses,
    tonicTriadPitchClasses,
} from '../../../../core/utils/improv/pitch.ts';

describe('parseKey', () => {
    it('解析大调与小调写法', () => {
        expect(parseKey('C')).toEqual({ key: 'C', tonicPitchClass: 0 });
        expect(parseKey('F#m')).toEqual({ key: 'F#m', tonicPitchClass: 6 });
        expect(parseKey('Bbm')).toEqual({ key: 'Bbm', tonicPitchClass: 10 });
        expect(parseKey('Cb')).toEqual({ key: 'Cb', tonicPitchClass: 11 });
    });

    it('非法写法返回 null', () => {
        expect(parseKey('')).toBeNull();
        expect(parseKey('H')).toBeNull();
        expect(parseKey('Cmajor')).toBeNull();
    });
});

describe('音阶', () => {
    it('C 大调 pitch classes', () => {
        expect(scalePitchClasses(0, 'Major (Ionian)')).toEqual([0, 2, 4, 5, 7, 9, 11]);
    });

    it('Blues 是六音音阶', () => {
        expect(scalePitchClasses(0, 'Blues')).toEqual([0, 3, 5, 6, 7, 10]);
    });

    it('isInScale 判断 MIDI', () => {
        expect(isInScale(60, 0, 'Major (Ionian)')).toBe(true);
        expect(isInScale(61, 0, 'Major (Ionian)')).toBe(false);
    });

    it('主三和弦按大/小三度取三音', () => {
        expect(tonicTriadPitchClasses(0, 'Major (Ionian)')).toEqual([0, 4, 7]);
        expect(tonicTriadPitchClasses(9, 'Natural Minor (Aeolian)')).toEqual([0, 4, 9]);
    });
});

describe('指板换算', () => {
    it('标准调弦空弦 MIDI', () => {
        const open = openStringMidis(STANDARD_TUNING);
        expect(open[1]).toBe(64);
        expect(open[2]).toBe(59);
        expect(open[6]).toBe(40);
    });

    it('fretToMidi 与 drop D 的 6 弦空弦', () => {
        expect(fretToMidi(STANDARD_TUNING, 1, 0)).toBe(64);
        expect(fretToMidi(TUNING_PRESETS.dropD, 6, 0)).toBe(38);
    });

    it('E4 在标准调弦上的所有候选位置', () => {
        const positions = midiToFretPositions(STANDARD_TUNING, 64, 0, 24);
        expect(positions).toEqual([
            { string: 1, fret: 0, midi: 64 },
            { string: 2, fret: 5, midi: 64 },
            { string: 3, fret: 9, midi: 64 },
            { string: 4, fret: 14, midi: 64 },
            { string: 5, fret: 19, midi: 64 },
            { string: 6, fret: 24, midi: 64 },
        ]);
    });

    it('可演奏范围与范围内调内音', () => {
        expect(playableMidiRange(STANDARD_TUNING, 24)).toEqual([40, 88]);
        expect(scaleMidisInRange(0, 'Major (Ionian)', 60, 72))
            .toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    });

    it('nearestMidiWithPitchClasses 找最近的主三和弦音', () => {
        expect(nearestMidiWithPitchClasses(65, [0, 4, 7], 40, 88)).toBe(64);
        expect(nearestMidiWithPitchClasses(66, [0, 4, 7], 40, 88)).toBe(67);
    });

    it('目标远在搜索范围外时仍能找到范围内最近音', () => {
        expect(nearestMidiWithPitchClasses(200, [0], 60, 72)).toBe(72);
        expect(nearestMidiWithPitchClasses(-100, [0], 60, 72)).toBe(60);
        expect(nearestMidiWithPitchClasses(200, [5], 60, 62)).toBeNull();
    });
});
