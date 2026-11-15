/**
 * resolveNoteFrequency — 调弦 + 音符 → 基频（含泛音）
 */

import { describe, it, expect } from 'vitest';
import { STANDARD_TUNING, type Note, type Tuning } from '../../../core/types/index.ts';
import { resolveNoteFrequency } from '../../../core/utils/noteFrequency.ts';

const DROP_D: Tuning = { ...STANDARD_TUNING, string6: 'D2' };

function note(partial: Partial<Note> = {}): Note {
    return { string: 1, fret: 0, duration: 0.25, ...partial };
}

describe('resolveNoteFrequency', () => {
    it('按调弦与品位取标准音高', () => {
        expect(resolveNoteFrequency(STANDARD_TUNING, note({ string: 1, fret: 0 })))
            .toBeCloseTo(329.63, 2);
        expect(resolveNoteFrequency(STANDARD_TUNING, note({ string: 1, fret: 12 })))
            .toBeCloseTo(659.25, 2);
        // 显式调弦：drop D 的 6 弦空弦是 D2
        expect(resolveNoteFrequency(DROP_D, note({ string: 6, fret: 0 })))
            .toBeCloseTo(73.42, 2);
    });

    it('自然泛音以空弦为基频，按节点品位叠加', () => {
        // 12 品 = 八度
        expect(resolveNoteFrequency(STANDARD_TUNING, note({
            string: 1, fret: 12, harmonic: 'natural',
        }))).toBeCloseTo(329.63 * 2, 2);
        // 5 品 = 两个八度（泛音表 5 → +24 半音）
        expect(resolveNoteFrequency(STANDARD_TUNING, note({
            string: 1, fret: 5, harmonic: 'natural',
        }))).toBeCloseTo(329.63 * 4, 2);
        // 7 品 = +19 半音
        expect(resolveNoteFrequency(STANDARD_TUNING, note({
            string: 1, fret: 7, harmonic: 'natural',
        }))).toBeCloseTo(329.63 * Math.pow(2, 19 / 12), 2);
    });

    it('人工/捏弦泛音以按弦音为基频，harmonicFret 省略时按默认 12', () => {
        // 1 弦 5 品 = A4 440Hz；默认 12 品节点 → 高八度
        expect(resolveNoteFrequency(STANDARD_TUNING, note({
            string: 1, fret: 5, harmonic: 'artificial',
        }))).toBeCloseTo(880, 2);
        expect(resolveNoteFrequency(STANDARD_TUNING, note({
            string: 1, fret: 5, harmonic: 'artificial', harmonicFret: 7,
        }))).toBeCloseTo(440 * Math.pow(2, 19 / 12), 2);
        // 显式节点覆盖默认值
        expect(resolveNoteFrequency(STANDARD_TUNING, note({
            string: 1, fret: 5, harmonic: 'pinch', harmonicFret: 12,
        }))).toBeCloseTo(880, 2);
    });

    it('缺弦号、非法弦号或无法解析时返回 0', () => {
        expect(resolveNoteFrequency(STANDARD_TUNING, note({ string: undefined }))).toBe(0);
        expect(resolveNoteFrequency(STANDARD_TUNING, note({ string: 7 }))).toBe(0);
    });
});
