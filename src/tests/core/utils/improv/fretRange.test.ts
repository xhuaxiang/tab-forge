/**
 * fretRange — 用户锁定把位的解析与生成约束测试。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import { STANDARD_TUNING } from '../../../../core/types/index.ts';
import type { FretRange, ScaleType } from '../../../../core/types/improv.ts';
import { resolveLocalImprovOptions } from '../../../../core/utils/improv/generate.ts';
import { generateLocalImprovisation } from '../../../../core/utils/improv/generate.ts';
import {
    midiToFretPositions,
    nearestMidiWithPitchClasses,
    nearestPlayableMidiWithPitchClasses,
} from '../../../../core/utils/improv/pitch.ts';
import { chordChartFromBars } from '../../../../core/utils/improv/progression.ts';

const CASES: Array<{ key: string; scaleType: ScaleType }> = [
    { key: 'C', scaleType: 'Major (Ionian)' },
    { key: 'G', scaleType: 'Major (Ionian)' },
    { key: 'D', scaleType: 'Major (Ionian)' },
    { key: 'Am', scaleType: 'Natural Minor (Aeolian)' },
];

describe('resolveLocalImprovOptions 与把位范围', () => {
    it('缺省为 null，表示沿用风格把位', () => {
        expect(resolveLocalImprovOptions().fretRange).toBeNull();
    });

    it('保留用户范围，自动交换大小并夹到可弹范围', () => {
        expect(resolveLocalImprovOptions({ fretRange: { min: 7, max: 10 } }).fretRange)
            .toEqual({ min: 7, max: 10 });
        expect(resolveLocalImprovOptions({ fretRange: { min: 10, max: 7 } }).fretRange)
            .toEqual({ min: 7, max: 10 });
        expect(resolveLocalImprovOptions({ fretRange: { min: -5, max: 99 } }).fretRange)
            .toEqual({
                min: LOCAL_IMPROV_CONFIG.playability.fretMin,
                max: LOCAL_IMPROV_CONFIG.playability.fretMax,
            });
    });

    it('非数字字段视为未提供', () => {
        expect(resolveLocalImprovOptions({
            fretRange: { min: Number.NaN, max: 10 },
        }).fretRange).toBeNull();
        expect(resolveLocalImprovOptions({
            fretRange: { min: 7, max: Number.POSITIVE_INFINITY },
        }).fretRange).toBeNull();
    });
});

describe('generateLocalImprovisation 与锁定把位', () => {
    it('4/4 下所有发声音符都落在 7-10 品', () => {
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 5; seed++) {
                const { notes } = generateLocalImprovisation({
                    numMeasures: 4,
                    key: caseItem.key,
                    scaleType: caseItem.scaleType,
                    style: 'Folk',
                    density: '中',
                    fretRange: { min: 7, max: 10 },
                    seed,
                });
                for (const item of notes) {
                    if (item.isRest) continue;
                    expect(item.fret).toBeGreaterThanOrEqual(7);
                    expect(item.fret).toBeLessThanOrEqual(10);
                }
                expect(notes.some(item => !item.isRest)).toBe(true);
            }
        }
    });

    it('6/8 下同样遵守把位范围', () => {
        for (let seed = 1; seed <= 5; seed++) {
            const { notes } = generateLocalImprovisation({
                numMeasures: 4,
                key: 'D',
                scaleType: 'Dorian',
                style: 'Jazz',
                density: '高',
                timeSignature: '6/8',
                fretRange: { min: 5, max: 8 },
                seed,
            });
            for (const item of notes) {
                if (item.isRest) continue;
                expect(item.fret).toBeGreaterThanOrEqual(5);
                expect(item.fret).toBeLessThanOrEqual(8);
            }
        }
    });

    it('未提供范围时仍能按风格把位生成', () => {
        const { notes, options } = generateLocalImprovisation({
            numMeasures: 2,
            key: 'G',
            style: 'Rock',
            seed: 2,
        });
        expect(options.fretRange).toBeNull();
        expect(notes.some(item => !item.isRest)).toBe(true);
    });

    it('窄窗口不再抛错，且所有发声都落在窗口内', () => {
        const cases: Array<{
            key: string;
            scaleType: ScaleType;
            style: 'Folk' | 'Blues' | 'Jazz';
            density: '中' | '高';
            range: FretRange;
        }> = [
            { key: 'G', scaleType: 'Major (Ionian)', style: 'Folk', density: '中', range: { min: 5, max: 8 } },
            { key: 'G', scaleType: 'Mixolydian', style: 'Folk', density: '中', range: { min: 5, max: 8 } },
            { key: 'A', scaleType: 'Major (Ionian)', style: 'Folk', density: '中', range: { min: 7, max: 10 } },
            { key: 'A', scaleType: 'Mixolydian', style: 'Folk', density: '中', range: { min: 7, max: 10 } },
            { key: 'C', scaleType: 'Major (Ionian)', style: 'Folk', density: '中', range: { min: 10, max: 12 } },
            // 审查回归：窄窗口 + 锚点/avoid note 冲突
            { key: 'F', scaleType: 'Major (Ionian)', style: 'Blues', density: '中', range: { min: 10, max: 12 } },
            { key: 'F', scaleType: 'Pentatonic Minor', style: 'Folk', density: '中', range: { min: 10, max: 12 } },
            { key: 'C#', scaleType: 'Natural Minor (Aeolian)', style: 'Jazz', density: '高', range: { min: 10, max: 11 } },
            { key: 'G#', scaleType: 'Natural Minor (Aeolian)', style: 'Jazz', density: '高', range: { min: 5, max: 6 } },
        ];
        for (const item of cases) {
            for (let seed = 1; seed <= 8; seed++) {
                const { notes } = generateLocalImprovisation({
                    numMeasures: 4,
                    key: item.key,
                    scaleType: item.scaleType,
                    style: item.style,
                    density: item.density,
                    fretRange: item.range,
                    seed,
                });
                expect(notes.some(note => !note.isRest)).toBe(true);
                for (const note of notes) {
                    if (note.isRest) continue;
                    expect(note.fret).toBeGreaterThanOrEqual(item.range.min);
                    expect(note.fret).toBeLessThanOrEqual(item.range.max);
                }
            }
        }
    });

    it('单品格窗口里没有和弦音时给出可读错误', () => {
        expect(() => generateLocalImprovisation({
            numMeasures: 4,
            key: 'F',
            scaleType: 'Natural Minor (Aeolian)',
            style: 'Jazz',
            density: '低',
            fretRange: { min: 12, max: 12 },
            seed: 1,
        })).toThrow(/锁定把位 12-12 品内没有和弦 Fm 的可演奏音/);
    });

    it('多和弦与锁定把位同时生效', () => {
        const chart = chordChartFromBars(
            [[1, 4], [5, 1], [6, 2], [5, 1]], 4, '4/4',
        );
        for (let seed = 1; seed <= 8; seed++) {
            const { notes, options } = generateLocalImprovisation({
                numMeasures: 4,
                key: 'C',
                scaleType: 'Major (Ionian)',
                style: 'Rock',
                density: '高',
                progression: [1, 4, 5, 1],
                chordChart: chart,
                fretRange: { min: 5, max: 8 },
                seed,
            });
            expect(options.fretRange).toEqual({ min: 5, max: 8 });
            expect(options.chordChart.length).toBe(chart.length);
            expect(notes.some(note => !note.isRest)).toBe(true);
            for (const note of notes) {
                if (note.isRest) continue;
                expect(note.fret).toBeGreaterThanOrEqual(5);
                expect(note.fret).toBeLessThanOrEqual(8);
            }
        }
    });
});

describe('nearestPlayableMidiWithPitchClasses', () => {
    it('非整数目标按最近整数音高搜索', () => {
        expect(nearestMidiWithPitchClasses(50.5, [2], 40, 60)).toBe(50);
        expect(nearestPlayableMidiWithPitchClasses(
            STANDARD_TUNING, 50.5, [2], 40, 60, 5, 8,
        )).toBe(50);
    });

    it('跳过品位窗口并集边界之间的空洞', () => {
        expect(midiToFretPositions(STANDARD_TUNING, 54, 5, 8)).toEqual([]);
        expect(nearestMidiWithPitchClasses(54, [6], 45, 72)).toBe(54);
        expect(nearestPlayableMidiWithPitchClasses(
            STANDARD_TUNING, 54, [6], 45, 72, 5, 8,
        )).toBe(66);
    });

    it('目标本身可弹时原样返回', () => {
        expect(nearestPlayableMidiWithPitchClasses(
            STANDARD_TUNING, 52, [4], 45, 72, 5, 8,
        )).toBe(52);
    });
});
