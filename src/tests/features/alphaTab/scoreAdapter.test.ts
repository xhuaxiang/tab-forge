/**
 * scoreAdapter 单元测试
 *
 * tabScoreToAlphaTabScore 是纯函数（无 DOM / audio），
 * 验证最易出错的映射规则：时值、弦序反转、调弦、休止、
 * 延音、技法、和弦分组、扫弦/琶音、tempo、拍号。
 */

import { describe, it, expect } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import type { Note, Measure, TabScore } from '../../../core/types/index.ts';
import { STANDARD_TUNING } from '../../../core/types/index.ts';
import {
    tabScoreToAlphaTabScore,
    noteNameToMidi,
    appDurationToAlpha,
} from '../../../features/alphaTab/scoreAdapter.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[], num = 4, den = 4): Measure {
    return { index: 0, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

function makeScore(measures: Measure[], bpm = 120, tuning = STANDARD_TUNING): TabScore {
    return { title: 't', artist: 'a', tuning, bpm, measures, timeSignature: '4/4' };
}

describe('appDurationToAlpha', () => {
    it('相对时值 → Duration 枚举（数值 1/2/4/8/16/32）', () => {
        const cases: Array<[Note['duration'], alphaTab.model.Duration]> = [
            [1, alphaTab.model.Duration.Whole],
            [0.5, alphaTab.model.Duration.Half],
            [0.25, alphaTab.model.Duration.Quarter],
            [0.125, alphaTab.model.Duration.Eighth],
            [0.0625, alphaTab.model.Duration.Sixteenth],
            [0.03125, alphaTab.model.Duration.ThirtySecond],
        ];
        for (const [app, expected] of cases) {
            expect(appDurationToAlpha(app)).toBe(expected);
        }
    });
});

describe('noteNameToMidi', () => {
    it('常见音名映射', () => {
        expect(noteNameToMidi('E4')).toBe(64);
        expect(noteNameToMidi('Eb4')).toBe(63);
        expect(noteNameToMidi('D#4')).toBe(63);
        expect(noteNameToMidi('C4')).toBe(60);
        expect(noteNameToMidi('A2')).toBe(45);
        expect(noteNameToMidi('F#3')).toBe(54);
    });
});

describe('tabScoreToAlphaTabScore', () => {
    it('时值映射写入 Beat.duration', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.5, string: 2 }),
            note({ duration: 0.0625, string: 3 }),
        ])]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats[0].duration).toBe(alphaTab.model.Duration.Quarter);
        expect(beats[1].duration).toBe(alphaTab.model.Duration.Half);
        expect(beats[2].duration).toBe(alphaTab.model.Duration.Sixteenth);
    });

    it('标准调弦 → tunings [64,59,55,50,45,40]；string=1(高E) → alphaTab string=6', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([note({ duration: 0.25 })])]));
        const staff = sc.tracks[0].staves[0];
        expect(staff.stringTuning.tunings).toEqual([64, 59, 55, 50, 45, 40]);
        expect(staff.bars[0].voices[0].beats[0].notes[0].string).toBe(6);
    });

    it('非标准调弦音名 → 对应 MIDI 值', () => {
        const dropD = makeScore([measure([note({ duration: 0.25 })])], 120, {
            string1: 'E4', string2: 'B3', string3: 'G3',
            string4: 'D3', string5: 'A2', string6: 'D2',
        });
        const staff = tabScoreToAlphaTabScore(dropD).tracks[0].staves[0];
        // D2 = (2+1)*12 + 2 = 38
        expect(staff.stringTuning.tunings).toEqual([64, 59, 55, 50, 45, 38]);
    });

    it('休止符 → 无音符的 Beat（notes.length===0）', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, isRest: true }),
        ])]));
        const beat = sc.tracks[0].staves[0].bars[0].voices[0].beats[0];
        expect(beat.notes).toHaveLength(0);
        expect(beat.duration).toBe(alphaTab.model.Duration.Quarter);
    });

    it('tieToNext 目标音符 → isTieDestination；技法音符不合并', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25, tieToNext: true }),
        ])]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats[0].notes[0].isTieDestination).toBe(false);
        expect(beats[1].notes[0].isTieDestination).toBe(true);

        // 带技法的 tieToNext 只表示弧线，不当作延音合并
        const sc2 = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25, tieToNext: true, technique: 'hammerOn' }),
        ])]));
        const beats2 = sc2.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats2[1].notes[0].isTieDestination).toBe(false);
    });

    it('跨小节 tie：目标在下一小节 → isTieDestination', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([
            measure([note({ duration: 0.25 })]),
            measure([note({ duration: 0.25, tieToNext: true })]),
        ]));
        const bars = sc.tracks[0].staves[0].bars;
        expect(bars[0].voices[0].beats[0].notes[0].isTieDestination).toBe(false);
        expect(bars[1].voices[0].beats[0].notes[0].isTieDestination).toBe(true);
    });

    it('hammerOn/pullOff → 前一同弦音符 isHammerPullOrigin', () => {
        const m = measure([
            note({ duration: 0.25, string: 2 }),
            note({ duration: 0.25, string: 2, fret: 2, technique: 'pullOff' }),
            note({ duration: 0.25 }),
            note({ duration: 0.25, fret: 2, technique: 'hammerOn' }),
        ]);
        const sc = tabScoreToAlphaTabScore(makeScore([m]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats[0].notes[0].isHammerPullOrigin).toBe(true);   // pullOff 的源
        expect(beats[1].notes[0].isHammerPullOrigin).toBe(false);  // 技法目标自身
        expect(beats[2].notes[0].isHammerPullOrigin).toBe(true);   // hammerOn 的源
    });

    it('slide → 前一同弦音符 slideOutType=Shift', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25, fret: 2, technique: 'slide' }),
        ])]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats[0].notes[0].slideOutType).toBe(alphaTab.model.SlideOutType.Shift);
    });

    it('bend → BendPoint [(0,0),(60,4)]；bendRelease → BendRelease 三点回弹', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, technique: 'bend', bendAmount: 1 }),
        ])]));
        const n = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        expect(n.bendType).toBe(alphaTab.model.BendType.Bend);
        expect(n.bendPoints!.map((p) => [p.offset, p.value])).toEqual([[0, 0], [60, 4]]);

        const sc2 = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, technique: 'bend', bendAmount: 0.5, bendRelease: true }),
        ])]));
        const n2 = sc2.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        expect(n2.bendType).toBe(alphaTab.model.BendType.BendRelease);
        expect(n2.bendPoints!.map((p) => [p.offset, p.value])).toEqual([[0, 0], [30, 2], [60, 0]]);
    });

    it('vibrato → VibratoType.Slight', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([
            note({ duration: 0.25, technique: 'vibrato' }),
        ])]));
        const n = sc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        expect(n.vibrato).toBe(alphaTab.model.VibratoType.Slight);
    });

    it('同 chordGroup → 同一 Beat 多音符；异组/单音 → 独立 Beat', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
            note({ duration: 0.25, chordGroup: 2 }),
            note({ duration: 0.25 }),
        ]);
        const sc = tabScoreToAlphaTabScore(makeScore([m]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats).toHaveLength(3);
        expect(beats[0].notes).toHaveLength(2);
        expect(beats[1].notes).toHaveLength(1);
        expect(beats[2].notes).toHaveLength(1);
    });

    it('strum/arpeggio → BrushType + brushDuration>0', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1, strum: 'down' }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
            note({ duration: 0.25, chordGroup: 1, string: 3 }),
            note({ duration: 0.25, chordGroup: 2, arpeggio: 'up' }),
            note({ duration: 0.25, chordGroup: 2, string: 2 }),
        ]);
        const sc = tabScoreToAlphaTabScore(makeScore([m], 120));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats[0].brushType).toBe(alphaTab.model.BrushType.BrushDown);
        expect(beats[0].brushDuration).toBeGreaterThan(0);
        expect(beats[1].brushType).toBe(alphaTab.model.BrushType.ArpeggioDown);
        expect(beats[1].brushDuration).toBeGreaterThan(0);
    });

    it('bpm=90 → score.tempo===90', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([note({ duration: 1 })])], 90));
        expect(sc.tempo).toBe(90);
    });

    it('6/8 → MasterBar 分子6 分母8', () => {
        const m = measure([note({ duration: 1 })], 6, 8);
        const sc = tabScoreToAlphaTabScore(makeScore([m]));
        expect(sc.masterBars[0].timeSignatureNumerator).toBe(6);
        expect(sc.masterBars[0].timeSignatureDenominator).toBe(8);
    });

    it('空小节 → 全音符休止 Beat 兜底', () => {
        const sc = tabScoreToAlphaTabScore(makeScore([measure([])]));
        const beats = sc.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats).toHaveLength(1);
        expect(beats[0].notes).toHaveLength(0);
        expect(beats[0].duration).toBe(alphaTab.model.Duration.Whole);
    });
});
