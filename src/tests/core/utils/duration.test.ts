/**
 * duration 单元测试
 *
 * durationName 是纯映射（无 DOM），验证：
 * 6 个合法时值的中文名，以及非法/未覆盖时值的 `${d}拍` 兜底。
 *
 * 注：`durationName` 现在是时值中文名的唯一来源（core/types 里那份
 * 用词不一致的 `DURATION_NAMES` 已删），故不再有「两处用词对比」。
 */

import { describe, it, expect } from 'vitest';
import { durationName, durationToBeats } from '../../../core/utils/duration.ts';

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

    it('0.0625 → 十六分', () => {
        expect(durationName(0.0625)).toBe('十六分');
    });

    it('0.03125 → 三十二分', () => {
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

describe('durationToBeats 时值 → 拍数', () => {
    it('6 个合法时值按比例换算（全音符=4 拍、四分=1 拍）', () => {
        const cases: Array<[number, number]> = [
            [1, 4],
            [0.5, 2],
            [0.25, 1],
            [0.125, 0.5],
            [0.0625, 0.25],
            [0.03125, 0.125],
        ];
        for (const [d, beats] of cases) {
            expect(durationToBeats(d)).toBeCloseTo(beats, 10);
        }
    });

    it('清单外的 1/3（三连音时值）→ 4/3 拍，不会被当成 1 拍', () => {
        expect(durationToBeats(1 / 3)).toBeCloseTo(4 / 3, 10);
        expect(durationToBeats(1 / 3)).not.toBeCloseTo(1, 10);
    });

    it('清单外的 0.3 → 1.2 拍，按比例换算而非回落', () => {
        expect(durationToBeats(0.3)).toBeCloseTo(1.2, 10);
        expect(durationToBeats(0.3)).not.toBeCloseTo(1, 10);
    });
});
