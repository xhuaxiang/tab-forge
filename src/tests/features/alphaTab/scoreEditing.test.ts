/**
 * scoreEditing 单元测试
 *
 * 只覆盖 alphaTab ↔ 应用的技法回读（detectTechnique）。
 * 时值、弦号、拍偏移的映射测试在 scoreMapping.test.ts，避免两处重复维护。
 */

import { describe, it, expect } from 'vitest';
import type { Note, Measure, TabScore } from '../../../core/types/index.ts';
import { STANDARD_TUNING } from '../../../core/types/index.ts';
import { tabScoreToAlphaTabScore } from '../../../features/alphaTab/scoreAdapter.ts';
import { detectTechnique } from '../../../core/utils/scoreMapping.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[], num = 4, den = 4): Measure {
    return { index: 0, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

function makeScore(measures: Measure[]): TabScore {
    return { title: 't', artist: 'a', tuning: STANDARD_TUNING, bpm: 120, measures, timeSignature: '4/4' };
}

describe('detectTechnique', () => {
    it('bend → bend + bendAmount（BendPoint.value/4）', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, technique: 'bend', bendAmount: 1 }),
        ])]));
        const n = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        const t = detectTechnique(n, 1);
        expect(t.tech).toBe('bend');
        expect(t.bendAmount).toBeCloseTo(1, 5);
    });

    it('vibrato → vibrato', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, technique: 'vibrato' }),
        ])]));
        const n = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        expect(detectTechnique(n, 1).tech).toBe('vibrato');
    });

    it('hammerOn → 前音符（origin）检测为 hammerOn + 目标品', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25, fret: 2, technique: 'hammerOn' }),
        ])]));
        const origin = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        const t = detectTechnique(origin, 1);
        expect(t.tech).toBe('hammerOn');
        expect(t.targetFret).toBe(2);
    });

    it('slide → 前音符（origin）检测为 slide', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25, fret: 2, technique: 'slide' }),
        ])]));
        const origin = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        const t = detectTechnique(origin, 1);
        expect(t.tech).toBe('slide');
    });
});
