/**
 * random — 种子 RNG 的确定性测试。
 */

import { describe, it, expect } from 'vitest';
import { createRng, pick, pickWeighted, randInt } from '../../../../core/utils/improv/random.ts';

describe('createRng', () => {
    it('同 seed 的前 100 个值完全相同', () => {
        const a = createRng(42);
        const b = createRng(42);
        const left = Array.from({ length: 100 }, () => a());
        const right = Array.from({ length: 100 }, () => b());
        expect(left).toEqual(right);
    });

    it('不同 seed 产生不同序列', () => {
        const a = createRng(1);
        const b = createRng(2);
        expect(Array.from({ length: 10 }, () => a()))
            .not.toEqual(Array.from({ length: 10 }, () => b()));
    });

    it('值落在 [0, 1)', () => {
        const rng = createRng(7);
        for (let index = 0; index < 1000; index++) {
            const value = rng();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });
});

describe('pick / pickWeighted / randInt', () => {
    it('pick 返回候选项之一，空数组抛错', () => {
        const rng = createRng(3);
        expect(['a', 'b', 'c']).toContain(pick(rng, ['a', 'b', 'c']));
        expect(() => pick(rng, [])).toThrow();
    });

    it('pickWeighted 对固定 seed 返回确定结果，且不取零权重项', () => {
        const rng = createRng(11);
        const items = [
            { value: 'never', weight: 0 },
            { value: 'always', weight: 1 },
        ];
        for (let index = 0; index < 20; index++) {
            expect(pickWeighted(rng, items)).toBe('always');
        }
    });

    it('randInt 是闭区间且包含端点', () => {
        const rng = createRng(5);
        const seen = new Set<number>();
        for (let index = 0; index < 200; index++) {
            const value = randInt(rng, 2, 4);
            expect(value).toBeGreaterThanOrEqual(2);
            expect(value).toBeLessThanOrEqual(4);
            expect(Number.isInteger(value)).toBe(true);
            seen.add(value);
        }
        expect(seen).toEqual(new Set([2, 3, 4]));
    });
});
