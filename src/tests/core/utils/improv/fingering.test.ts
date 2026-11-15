/**
 * fingering — 标准五型指法 → 把位窗口的换算测试。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type {
    FingeringPattern,
    FretRange,
    PlayabilityRules,
    ScaleType,
} from '../../../../core/types/improv/index.ts';
import type { Tuning } from '../../../../core/types/tuning/index.ts';
import {
    STANDARD_TUNING,
    TUNING_PRESETS,
} from '../../../../core/types/tuning/index.ts';
import { fingeringFretRange } from '../../../../core/utils/improv/fingering.ts';
import { parseKey } from '../../../../core/utils/improv/pitch.ts';

const WINDOW_WIDTH = 4;
const PLAYABILITY: PlayabilityRules = LOCAL_IMPROV_CONFIG.playability;

/** C 大调五型：Mi / Sol / La / Si / Re */
const C_MAJOR_TABLE: ReadonlyArray<readonly [FingeringPattern, FretRange]> = [
    ['Mi', { min: 0, max: 3 }],
    ['Sol', { min: 3, max: 6 }],
    ['La', { min: 5, max: 8 }],
    ['Si', { min: 7, max: 10 }],
    ['Re', { min: 10, max: 13 }],
];

function tonicOf(key: string): number {
    const parsed = parseKey(key);
    if (parsed === null) throw new Error(`测试用调性非法: ${key}`);
    return parsed.tonicPitchClass;
}

function range(
    pattern: FingeringPattern,
    key: string,
    scaleType: ScaleType,
    tuning: Tuning = STANDARD_TUNING,
    playability: PlayabilityRules = PLAYABILITY,
    windowWidth = WINDOW_WIDTH,
): FretRange | null {
    return fingeringFretRange(
        pattern,
        tonicOf(key),
        scaleType,
        tuning,
        playability,
        windowWidth,
    );
}

describe('fingeringFretRange 标准五型', () => {
    it('C 大调五型窗口为 0-3 / 3-6 / 5-8 / 7-10 / 10-13', () => {
        for (const [pattern, expected] of C_MAJOR_TABLE) {
            expect(range(pattern, 'C', 'Major (Ionian)')).toEqual(expected);
        }
    });

    it('A 小调与 C 大调同表（按关系大调换算）', () => {
        expect(tonicOf('Am')).toBe(9);
        for (const [pattern, expected] of C_MAJOR_TABLE) {
            expect(range(pattern, 'Am', 'Natural Minor (Aeolian)'))
                .toEqual(expected);
        }
    });

    it('E 小调的 La 型锚在 6 弦空弦', () => {
        expect(range('La', 'Em', 'Natural Minor (Aeolian)'))
            .toEqual({ min: 0, max: 3 });
    });
});

describe('fingeringFretRange 音阶缺级', () => {
    it('A 小调五声没有 Si 级，La 型仍在 5-8 品', () => {
        expect(range('Si', 'Am', 'Pentatonic Minor')).toBeNull();
        expect(range('La', 'Am', 'Pentatonic Minor'))
            .toEqual({ min: 5, max: 8 });
    });

    it('A Blues 没有 Si 级，La 型仍在 5-8 品', () => {
        expect(range('Si', 'Am', 'Blues')).toBeNull();
        expect(range('La', 'Am', 'Blues')).toEqual({ min: 5, max: 8 });
    });

    it('A 和声小调的 Sol 锚点是自然 7 级 G，音阶里是 G# → null', () => {
        // 指型锚点按关系大调取，和声小调把 7 级升了半音，故 Sol 型不可用；
        // 调用方（pipeline）会提示「未能换算到可演奏把位」并回退，不静默。
        expect(range('Sol', 'Am', 'Harmonic Minor')).toBeNull();
        expect(range('La', 'Am', 'Harmonic Minor')).toEqual({ min: 5, max: 8 });
    });
});

describe('fingeringFretRange 调弦', () => {
    it('Drop D 下调弦锚品随 6 弦移动，La 型为 7-10 品', () => {
        const presets: Record<string, Tuning | undefined> = TUNING_PRESETS;
        const dropD = presets.dropD ?? { ...STANDARD_TUNING, string6: 'D2' };
        expect(range('La', 'C', 'Major (Ionian)', dropD))
            .toEqual({ min: 7, max: 10 });
    });

    it('6 弦为 A2 时 C 大调 La 型落在空弦 0-3 品', () => {
        const tuning: Tuning = { ...STANDARD_TUNING, string6: 'A2' };
        expect(range('La', 'C', 'Major (Ionian)', tuning))
            .toEqual({ min: 0, max: 3 });
    });
});

describe('fingeringFretRange 可演奏范围', () => {
    it('fretMin=5 时取该音的下一个八度，C 大调 Mi 为 12-15 品', () => {
        const playability: PlayabilityRules = {
            ...PLAYABILITY,
            fretMin: 5,
        };
        expect(range('Mi', 'C', 'Major (Ionian)', STANDARD_TUNING, playability))
            .toEqual({ min: 12, max: 15 });
    });

    it('fretMax=12 时窗口越界返回 null，不向下平移', () => {
        const playability: PlayabilityRules = {
            ...PLAYABILITY,
            fretMax: 12,
        };
        // Re 型锚品在 10 品，窗口 10-13 超出 fretMax
        expect(range('Re', 'C', 'Major (Ionian)', STANDARD_TUNING, playability))
            .toBeNull();
    });
});

describe('fingeringFretRange 非法输入', () => {
    it('窗口宽度为 0、负数或非有限数时返回 null', () => {
        expect(range('La', 'C', 'Major (Ionian)', STANDARD_TUNING, PLAYABILITY, 0))
            .toBeNull();
        expect(range('La', 'C', 'Major (Ionian)', STANDARD_TUNING, PLAYABILITY, -1))
            .toBeNull();
        expect(range(
            'La', 'C', 'Major (Ionian)', STANDARD_TUNING, PLAYABILITY,
            Number.NaN,
        )).toBeNull();
        expect(range(
            'La', 'C', 'Major (Ionian)', STANDARD_TUNING, PLAYABILITY,
            Number.POSITIVE_INFINITY,
        )).toBeNull();
    });

    it('调弦音名非法时返回 null', () => {
        const tuning: Tuning = { ...STANDARD_TUNING, string6: 'H2' };
        expect(range('La', 'C', 'Major (Ionian)', tuning)).toBeNull();
    });
});
