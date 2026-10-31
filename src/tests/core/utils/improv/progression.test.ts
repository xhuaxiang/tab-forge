/**
 * progression — 和弦文本解析、和弦表展开与展示测试。
 */

import { describe, it, expect } from 'vitest';
import type {
    ChordSpec,
    ProgressionStep,
} from '../../../../core/types/improv.ts';
import {
    buildChordChart,
    chordChartFromBars,
    formatChordSpec,
    formatProgression,
    formatProgressionStep,
    isChordEvent,
    isChordQuality,
    normalizeChordChart,
    parseChordChartText,
    parseProgressionText,
    parseProgressionToken,
    progressionEquals,
} from '../../../../core/utils/improv/progression.ts';

const C: ChordSpec = { rootPitchClass: 0, quality: 'major' };
const F: ChordSpec = { rootPitchClass: 5, quality: 'major' };
const G: ChordSpec = { rootPitchClass: 7, quality: 'major' };
const Am: ChordSpec = { rootPitchClass: 9, quality: 'minor' };

describe('parseProgressionToken', () => {
    it('识别阿拉伯数字级数与罗马数字', () => {
        expect(parseProgressionToken('1')).toBe(1);
        expect(parseProgressionToken('7')).toBe(7);
        expect(parseProgressionToken('IV')).toBe(4);
        expect(parseProgressionToken('vi')).toBe(6);
        expect(parseProgressionToken('bIII')).toBeNull();
        expect(parseProgressionToken('8')).toBeNull();
    });

    it('识别常见显式和弦与后缀', () => {
        expect(parseProgressionToken('C')).toEqual(C);
        expect(parseProgressionToken('Am')).toEqual(Am);
        expect(parseProgressionToken('F#m7b5')).toEqual({
            rootPitchClass: 6,
            quality: 'halfDiminished7',
        });
        expect(parseProgressionToken('Dmaj7')).toEqual({
            rootPitchClass: 2,
            quality: 'major7',
        });
        expect(parseProgressionToken('G7')).toEqual({
            rootPitchClass: 7,
            quality: 'dominant7',
        });
        expect(parseProgressionToken('Cdim7')).toEqual({
            rootPitchClass: 0,
            quality: 'diminished7',
        });
        expect(parseProgressionToken('Caug')).toEqual({
            rootPitchClass: 0,
            quality: 'augmented',
        });
        expect(parseProgressionToken('Bb')).toEqual({
            rootPitchClass: 10,
            quality: 'major',
        });
    });

    it('空串与未知后缀返回 null', () => {
        expect(parseProgressionToken('')).toBeNull();
        expect(parseProgressionToken('H')).toBeNull();
        expect(parseProgressionToken('Csus4')).toBeNull();
    });
});

describe('parseProgressionText', () => {
    it('支持空格、逗号、分号、小节线与 en dash 分隔', () => {
        expect(parseProgressionText('C G Am F')).toEqual([C, G, Am, F]);
        expect(parseProgressionText('C, G; Am | F')).toEqual([C, G, Am, F]);
        expect(parseProgressionText('C，G、Am F')).toEqual([C, G, Am, F]);
        expect(parseProgressionText('ii–V–I')).toEqual([2, 5, 1]);
        expect(parseProgressionText('2-5-1')).toEqual([2, 5, 1]);
    });

    it('空文本或任一 token 非法时整组返回 null', () => {
        expect(parseProgressionText('')).toBeNull();
        expect(parseProgressionText('   ')).toBeNull();
        expect(parseProgressionText('C H Am')).toBeNull();
    });
});

describe('parseChordChartText', () => {
    it('只认带小节线的写法，并按小节分组', () => {
        expect(parseChordChartText('C G Am F')).toBeNull();
        expect(parseChordChartText('| C G | Am F |')).toEqual([
            [C, G],
            [Am, F],
        ]);
    });

    it('空小节被忽略，非法小节使整张表返回 null', () => {
        expect(parseChordChartText('| C | | G |')).toEqual([[C], [G]]);
        expect(parseChordChartText('| C | H |')).toBeNull();
        expect(parseChordChartText('|')).toBeNull();
    });
});

describe('chordChartFromBars', () => {
    it('4/4 下每小节和弦等分铺开', () => {
        const chart = chordChartFromBars([[1, 4], [5, 1]], 2, '4/4');
        expect(chart.map(event => [event.measure, event.start, event.chord]))
            .toEqual([
                [0, 0, 1],
                [0, 0.5, 4],
                [1, 0, 5],
                [1, 0.5, 1],
            ]);
    });

    it('6/8 下按 0.75 的小节容量等分', () => {
        const chart = chordChartFromBars([[1, 4]], 1, '6/8');
        expect(chart.map(event => event.start)).toEqual([0, 0.375]);
    });

    it('小节多出来时循环，最后一小节强制使用最后一组', () => {
        const chart = chordChartFromBars([[1], [4], [5]], 5, '4/4');
        expect(chart.map(event => event.chord)).toEqual([1, 4, 5, 1, 5]);
    });

    it('小节少于和弦组数时保留尾部，与 progression 的收尾规则一致', () => {
        const bars = [[1], [4], [5], [2]] as ProgressionStep[][];
        expect(chordChartFromBars(bars, 2, '4/4').map(event => event.chord))
            .toEqual([5, 2]);
        expect(chordChartFromBars(bars, 3, '4/4').map(event => event.chord))
            .toEqual([4, 5, 2]);
    });
});

describe('buildChordChart', () => {
    it('每小节 1 个和弦时返回空表，保留旧的 progression 铺法', () => {
        expect(buildChordChart([1, 4, 5, 1], 4, 1, '4/4')).toEqual([]);
    });

    it('每小节 2 个和弦时按槽位等分', () => {
        const chart = buildChordChart([1, 4, 5, 1], 2, 2, '4/4');
        expect(chart.map(event => [event.measure, event.start, event.chord]))
            .toEqual([
                [0, 0, 1],
                [0, 0.5, 4],
                [1, 0, 5],
                [1, 0.5, 1],
            ]);
    });

    it('槽位少于进行长度时取进行收尾', () => {
        const chart = buildChordChart([1, 4, 5, 6, 2], 2, 2, '4/4');
        expect(chart.map(event => event.chord)).toEqual([4, 5, 6, 2]);
    });

    it('槽位多于进行长度时循环，并强制最后一槽收尾', () => {
        const steps: ProgressionStep[] = [1, 4, 5];
        const chart = buildChordChart(steps, 2, 2, '4/4');
        expect(chart.map(event => event.chord)).toEqual([1, 4, 5, 5]);
        expect(chart[3].measure).toBe(1);
        expect(chart[3].start).toBe(0.5);
    });

    it('非法拍号、空进行与非法小节数返回空表', () => {
        expect(buildChordChart([1], 2, 2, '0/4')).toEqual([]);
        expect(buildChordChart([], 2, 2, '4/4')).toEqual([]);
        expect(buildChordChart([1], 0, 2, '4/4')).toEqual([]);
    });
});

describe('normalizeChordChart', () => {
    it('丢弃越界事件，保留合法事件并按位置排序', () => {
        const chart = normalizeChordChart([
            { measure: 1, start: 0.5, chord: 4 },
            { measure: 0, start: 0, chord: 1 },
            { measure: 5, start: 0, chord: 7 },
            { measure: 0, start: 2, chord: 5 },
            { measure: 0, start: -1, chord: 6 },
            { measure: 0, start: 0, chord: { rootPitchClass: 99, quality: 'major' } },
        ], 2, 1);
        expect(chart.map(event => [event.measure, event.start, event.chord]))
            .toEqual([
                [0, 0, 1],
                [1, 0.5, 4],
            ]);
    });

    it('同一位置后写的事件覆盖先写的，和弦对象被克隆', () => {
        const chord: ChordSpec = { rootPitchClass: 2, quality: 'minor7' };
        const chart = normalizeChordChart([
            { measure: 0, start: 0, chord: 1 },
            { measure: 0, start: 0, chord },
        ], 1, 1);
        expect(chart).toHaveLength(1);
        expect(chart[0].chord).toEqual(chord);
        expect(chart[0].chord).not.toBe(chord);
    });
});

describe('运行时校验', () => {
    it('和弦质量只认白名单', () => {
        expect(isChordQuality('minor7')).toBe(true);
        expect(isChordQuality('sus4')).toBe(false);
        expect(isChordQuality(1)).toBe(false);
    });

    it('和弦事件校验小节、位置与和弦本身', () => {
        expect(isChordEvent({ measure: 0, start: 0, chord: 1 })).toBe(true);
        expect(isChordEvent({ measure: 1, start: 0.5, chord: C })).toBe(true);
        expect(isChordEvent({ measure: 0.5, start: 0, chord: 1 })).toBe(false);
        expect(isChordEvent({ measure: 0, start: NaN, chord: 1 })).toBe(false);
        expect(isChordEvent({ measure: 0, start: 0, chord: 8 })).toBe(false);
        expect(isChordEvent(null)).toBe(false);
    });
});

describe('格式化与比较', () => {
    it('级数用罗马数字，显式和弦用根音 + 质量后缀', () => {
        expect(formatProgressionStep(1)).toBe('I');
        expect(formatProgressionStep(6)).toBe('VI');
        expect(formatChordSpec({ rootPitchClass: 6, quality: 'halfDiminished7' }))
            .toBe('F#m7b5');
        expect(formatProgression([1, 4, 5, 1])).toBe('I–IV–V–I');
        expect(formatProgression([C, Am], ' ')).toBe('C Am');
    });

    it('深比较级数与显式和弦', () => {
        expect(progressionEquals([1, 4], [1, 4])).toBe(true);
        expect(progressionEquals([C, Am], [
            { rootPitchClass: 0, quality: 'major' },
            { rootPitchClass: 9, quality: 'minor' },
        ])).toBe(true);
        expect(progressionEquals([1, 4], [1, 5])).toBe(false);
        expect(progressionEquals([1], [1, 4])).toBe(false);
    });
});
