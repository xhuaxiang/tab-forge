/**
 * duration 单元测试
 *
 * durationName 是纯映射（无 DOM），验证：
 * 6 个合法时值的中文名、非法/未覆盖时值的 `${d}拍` 兜底，
 * 以及它与 core/types 的 DURATION_NAMES 用词的差异（事实记录）。
 */

import { describe, it, expect } from 'vitest';
import { durationName } from '../../../core/utils/duration.ts';
import { DURATION_NAMES } from '../../../core/types/index.ts';

describe('durationName 合法时值', () => {
    it('1 → 全音符', () => {
        expect(durationName(1)).toBe('全音符');
    });

    it('0.5 → 二分音符', () => {
        expect(durationName(0.5)).toBe('二分音符');
    });

    it('0.25 → 四分音符', () => {
        expect(durationName(0.25)).toBe('四分音符');
    });

    it('0.125 → 八分音符', () => {
        expect(durationName(0.125)).toBe('八分音符');
    });

    it('0.0625 → 十六分（不带「音符」二字，与 DURATION_NAMES 不一致）', () => {
        expect(durationName(0.0625)).toBe('十六分');
    });

    it('0.03125 → 三十二分（不带「音符」二字，与 DURATION_NAMES 不一致）', () => {
        expect(durationName(0.03125)).toBe('三十二分');
    });

    it('6 个合法时值全表逐项命中，均不落到兜底分支', () => {
        const cases: Array<[number, string]> = [
            [1, '全音符'],
            [0.5, '二分音符'],
            [0.25, '四分音符'],
            [0.125, '八分音符'],
            [0.0625, '十六分'],
            [0.03125, '三十二分'],
        ];
        for (const [d, name] of cases) {
            expect(durationName(d)).toBe(name);
            // 合法值不得出现兜底格式
            expect(durationName(d)).not.toBe(`${d}拍`);
        }
    });
});

describe('durationName 非法/未覆盖时值兜底', () => {
    it('0 → "0拍"', () => {
        expect(durationName(0)).toBe('0拍');
    });

    it('0.3（非 2 的幂）→ "0.3拍"', () => {
        expect(durationName(0.3)).toBe('0.3拍');
    });

    it('-1（负数）→ "-1拍"', () => {
        expect(durationName(-1)).toBe('-1拍');
    });

    it('NaN → "NaN拍"（NaN 不命中映射表）', () => {
        expect(durationName(NaN)).toBe('NaN拍');
    });

    it('undefined（运行时越界调用）→ "undefined拍"', () => {
        // 签名声明为 number，此处故意绕过类型以覆盖运行时兜底分支
        expect(durationName(undefined as unknown as number)).toBe('undefined拍');
    });

    it('0.015625（三十二分再细分，映射表未收录）→ 兜底而非被截断', () => {
        expect(durationName(0.015625)).toBe('0.015625拍');
    });
});

describe('durationName 与 DURATION_NAMES 用词对比', () => {
    it('1 / 0.5 / 0.25 / 0.125 四处用词完全一致', () => {
        for (const d of [1, 0.5, 0.25, 0.125]) {
            expect(durationName(d)).toBe(DURATION_NAMES[d]);
        }
    });

    it('0.0625 与 0.03125 两处用词不一致（durationName 少「音符」二字）', () => {
        expect(DURATION_NAMES[0.0625]).toBe('十六分音符');
        expect(durationName(0.0625)).toBe('十六分');
        expect(durationName(0.0625)).not.toBe(DURATION_NAMES[0.0625]);

        expect(DURATION_NAMES[0.03125]).toBe('三十二分音符');
        expect(durationName(0.03125)).toBe('三十二分');
        expect(durationName(0.03125)).not.toBe(DURATION_NAMES[0.03125]);
    });
});
