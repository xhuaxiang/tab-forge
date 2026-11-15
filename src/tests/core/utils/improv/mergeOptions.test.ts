/**
 * mergeImprovOptions — base < AI < local 的逐字段合并与白名单。
 */

import { describe, it, expect } from 'vitest';
import type {
    ChordSpec,
    ImprovBriefOptions,
    Progression,
    ProgressionStep,
} from '../../../../core/types/improv/index.ts';
import { mergeImprovOptions } from '../../../../core/utils/improv/mergeOptions.ts';

describe('mergeImprovOptions 优先级', () => {
    it('local > AI > base：三份都给出同一字段时 local 赢', () => {
        const base: ImprovBriefOptions = {
            numMeasures: 2,
            key: 'C',
            scaleType: 'Major (Ionian)',
            style: 'Folk',
            density: '低',
            timeSignature: '4/4',
            fingering: 'La',
            fretRange: { min: 5, max: 8 },
            progression: [1, 4],
            chordsPerMeasure: 1,
        };
        const ai: ImprovBriefOptions = {
            numMeasures: 4,
            key: 'G',
            scaleType: 'Blues',
            style: 'Jazz',
            density: '高',
            timeSignature: '3/4',
            fingering: 'Mi',
            fretRange: { min: 2, max: 5 },
            progression: [1, 5],
            chordsPerMeasure: 2,
        };
        const local: ImprovBriefOptions = {
            key: 'Am',
            style: 'Blues',
            density: '中',
            progression: [1, 6],
        };

        expect(mergeImprovOptions(base, ai, local)).toEqual({
            numMeasures: 4,
            key: 'Am',
            scaleType: 'Blues',
            style: 'Blues',
            density: '中',
            timeSignature: '3/4',
            fingering: 'Mi',
            fretRange: { min: 2, max: 5 },
            progression: [1, 6],
            chordsPerMeasure: 2,
        });
    });

    it('local 缺省时 AI 覆盖 base；两者都缺省时保留 base', () => {
        const merged = mergeImprovOptions(
            { numMeasures: 2, key: 'C', density: '低', timeSignature: '4/4' },
            { numMeasures: 4, key: 'G' },
            { density: '高' },
        );

        expect(merged).toEqual({
            numMeasures: 4,
            key: 'G',
            density: '高',
            timeSignature: '4/4',
        });
    });
});

describe('mergeImprovOptions 逐字段合并', () => {
    it('三份来源各含部分字段时逐字段合并，未给出的键不出现', () => {
        const merged = mergeImprovOptions(
            { key: 'C', timeSignature: '4/4', fretRange: { min: 0, max: 3 } },
            { numMeasures: 4, progression: [1, 5] },
            { density: '高' },
        );

        expect(merged).toEqual({
            key: 'C',
            timeSignature: '4/4',
            fretRange: { min: 0, max: 3 },
            numMeasures: 4,
            progression: [1, 5],
            density: '高',
        });
    });

    it('显式 undefined 不覆盖已有值', () => {
        const merged = mergeImprovOptions(
            { key: 'C', numMeasures: 2 },
            { key: undefined },
            { numMeasures: undefined },
        );

        expect(merged).toEqual({ key: 'C', numMeasures: 2 });
    });
});

describe('mergeImprovOptions 不可变性', () => {
    it('不修改三份入参', () => {
        const base: ImprovBriefOptions = {
            key: 'C',
            fretRange: { min: 5, max: 8 },
            progression: [1, 4],
        };
        const ai: ImprovBriefOptions = {
            numMeasures: 4,
            progression: [1, 5, { rootPitchClass: 7, quality: 'major' }],
        };
        const local: ImprovBriefOptions = {
            density: '高',
            timeSignature: '3/4',
            fretRange: { min: 7, max: 10 },
        };
        const snapshots = [
            structuredClone(base),
            structuredClone(ai),
            structuredClone(local),
        ];

        const merged = mergeImprovOptions(base, ai, local);

        expect([base, ai, local]).toEqual(snapshots);
        expect(merged).not.toBe(base);
    });

    it('fretRange / progression 返回新引用，改返回值不影响入参', () => {
        const range = { min: 5, max: 8 };
        const progression: Progression = [1, 4];
        const base: ImprovBriefOptions = { fretRange: range, progression };

        const merged = mergeImprovOptions(base);

        expect(merged.fretRange).not.toBe(range);
        expect(merged.progression).not.toBe(progression);

        merged.fretRange!.min = 9;
        (merged.progression as ProgressionStep[])[1] = 5;
        expect(range.min).toBe(5);
        expect(progression[1]).toBe(4);
    });

    it('progression 中的显式和弦对象也会被克隆', () => {
        const spec: ChordSpec = { rootPitchClass: 0, quality: 'major' };
        const progression: Progression = [1, spec];

        const merged = mergeImprovOptions({ progression });
        const cloned = merged.progression![1] as ChordSpec;

        expect(cloned).not.toBe(spec);
        cloned.quality = 'minor';
        expect(spec.quality).toBe('major');
    });
});

describe('mergeImprovOptions 白名单', () => {
    it('运行时未知键不进入结果', () => {
        const input = {
            key: 'C',
            tuning: { string1: 'E4' },
            seed: 9,
            chordChart: [],
        } as unknown as ImprovBriefOptions;

        const merged = mergeImprovOptions(input);

        expect(merged).toEqual({ key: 'C' });
        expect('tuning' in merged).toBe(false);
        expect('seed' in merged).toBe(false);
        expect('chordChart' in merged).toBe(false);
    });

    it('无参数时返回空对象', () => {
        expect(mergeImprovOptions()).toEqual({});
    });
});
