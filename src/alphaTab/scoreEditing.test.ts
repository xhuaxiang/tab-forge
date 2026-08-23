/**
 * scoreEditing 单元测试
 *
 * 验证 alphaTab ↔ 应用映射：时值反向、弦号反转、
 * beat 拍偏移、技法检测。
 */

import { describe, it, expect } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import type { Note, Measure, TabScore } from '../types/index.ts';
import { STANDARD_TUNING } from '../types/index.ts';
import { tabScoreToAlphaTabScore } from './scoreAdapter.ts';
import {
    alphaDurationToAppDuration,
    alphaStringToAppString,
    beatOffsetInMeasure,
    detectTechnique,
} from './scoreMapping.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[], num = 4, den = 4): Measure {
    return { index: 0, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

function makeScore(measures: Measure[]): TabScore {
    return { title: 't', artist: 'a', tuning: STANDARD_TUNING, bpm: 120, measures, timeSignature: '4/4' };
}

describe('alphaDurationToAppDuration', () => {
    it('Duration 枚举 → 应用相对时值', () => {
        const cases: Array<[alphaTab.model.Duration, number]> = [
            [alphaTab.model.Duration.Whole, 1],
            [alphaTab.model.Duration.Half, 0.5],
            [alphaTab.model.Duration.Quarter, 0.25],
            [alphaTab.model.Duration.Eighth, 0.125],
            [alphaTab.model.Duration.Sixteenth, 0.0625],
            [alphaTab.model.Duration.ThirtySecond, 0.03125],
        ];
        for (const [d, expected] of cases) {
            expect(alphaDurationToAppDuration(d)).toBeCloseTo(expected, 5);
        }
    });
});

describe('alphaStringToAppString', () => {
    it('弦号反转（alphaTab 1=最低弦 ↔ 应用 1=最高弦）', () => {
        expect(alphaStringToAppString(6)).toBe(1);
        expect(alphaStringToAppString(1)).toBe(6);
        expect(alphaStringToAppString(4)).toBe(3);
    });
});

describe('beatOffsetInMeasure', () => {
    it('[Q,Q,H] 第3拍偏移 0.5，第1拍偏移 0', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25 }), note({ duration: 0.25 }), note({ duration: 0.5 }),
        ])]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats).toHaveLength(3);
        expect(beatOffsetInMeasure(beats[0])).toBeCloseTo(0, 5);
        expect(beatOffsetInMeasure(beats[2])).toBeCloseTo(0.5, 5);
    });
});

describe('detectTechnique', () => {
    it('bend → bend + bendAmount（BendPoint.value/4）', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, technique: 'bend', bendAmount: 1 }),
        ])]));
        const n = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        const t = detectTechnique(n);
        expect(t.tech).toBe('bend');
        expect(t.bendAmount).toBeCloseTo(1, 5);
    });

    it('vibrato → vibrato', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, technique: 'vibrato' }),
        ])]));
        const n = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        expect(detectTechnique(n).tech).toBe('vibrato');
    });

    it('hammerOn → 前音符（origin）检测为 hammerOn + 目标品', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25, fret: 2, technique: 'hammerOn' }),
        ])]));
        const origin = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        const t = detectTechnique(origin);
        expect(t.tech).toBe('hammerOn');
        expect(t.targetFret).toBe(2);
    });

    it('slide → 前音符（origin）检测为 slide', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25, fret: 2, technique: 'slide' }),
        ])]));
        const origin = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        const t = detectTechnique(origin);
        expect(t.tech).toBe('slide');
    });
});
