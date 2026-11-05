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

    it('hammerOn → 到达音检测为 hammerOn，目标品是自身品位（不是起点）', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, fret: 0 }),
            note({ duration: 0.25, fret: 2, technique: 'hammerOn' }),
        ])]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        const t = detectTechnique(beats[1].notes[0], 1);
        expect(t.tech).toBe('hammerOn');
        expect(t.targetFret).toBe(2);
        // 起点音在应用数据里是普通音，不应回读出技法（否则编辑应用会改写起点音）
        expect(detectTechnique(beats[0].notes[0], 1).tech).toBe('none');
    });

    it('pullOff → 到达音检测为 pullOff，目标品是自身品位（不是上方的起点品）', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, fret: 5 }),
            note({ duration: 0.25, fret: 2, technique: 'pullOff' }),
        ])]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        const t = detectTechnique(beats[1].notes[0], 1);
        expect(t.tech).toBe('pullOff');
        expect(t.targetFret).toBe(2);
        expect(detectTechnique(beats[0].notes[0], 1).tech).toBe('none');
    });

    it('slide → 到达音检测为 slide，目标品是自身品位', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, fret: 5 }),
            note({ duration: 0.25, fret: 2, technique: 'slide' }),
        ])]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        const t = detectTechnique(beats[1].notes[0], 1);
        expect(t.tech).toBe('slide');
        expect(t.targetFret).toBe(2);
        expect(detectTechnique(beats[0].notes[0], 1).tech).toBe('none');
    });
});
