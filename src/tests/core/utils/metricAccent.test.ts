/**
 * metricAccent 单元测试
 *
 * 播放侧的拍位重音是纯映射：拍号 + 拍位偏移 → 派生力度。
 * 这里钉住三件事：
 *   1. 各拍号的强拍位置（规则本身来自 classifySlotRole，不在这里重写）；
 *   2. 显式 dynamics 永远优先；
 *   3. 派生结果与 classifySlotRole 不漂移。
 */

import { describe, it, expect } from 'vitest';
import type { NoteDuration } from '../../../core/types/index.ts';
import { classifySlotRole } from '../../../core/utils/improv/rhythm.ts';
import { metricDynamics, resolveNoteDynamics } from '../../../core/utils/metricAccent.ts';

const QUARTER: NoteDuration = 0.25;
const EIGHTH: NoteDuration = 0.125;

describe('metricDynamics 拍号规则', () => {
    it('4/4：第 1、3 拍派生 accent，第 2、4 拍不派生', () => {
        expect(metricDynamics(0, QUARTER, '4/4')).toBe('accent');
        expect(metricDynamics(0.25, QUARTER, '4/4')).toBeUndefined();
        expect(metricDynamics(0.5, QUARTER, '4/4')).toBe('accent');
        expect(metricDynamics(0.75, QUARTER, '4/4')).toBeUndefined();
    });

    it('4/4 反拍八分 / 十六分落在拍内，不派生', () => {
        expect(metricDynamics(0.125, EIGHTH, '4/4')).toBeUndefined();
        expect(metricDynamics(0.0625, 0.0625, '4/4')).toBeUndefined();
    });

    it('3/4、2/4：只有第 1 拍派生', () => {
        for (const sig of ['3/4', '2/4']) {
            expect(metricDynamics(0, QUARTER, sig)).toBe('accent');
            expect(metricDynamics(0.25, QUARTER, sig)).toBeUndefined();
            expect(metricDynamics(0.5, QUARTER, sig)).toBeUndefined();
        }
    });

    it('5/4：按 3+2 分组，第 1、4 拍派生', () => {
        expect(metricDynamics(0, QUARTER, '5/4')).toBe('accent');
        expect(metricDynamics(0.25, QUARTER, '5/4')).toBeUndefined();
        expect(metricDynamics(0.5, QUARTER, '5/4')).toBeUndefined();
        expect(metricDynamics(0.75, QUARTER, '5/4')).toBe('accent');
    });

    it('6/8、9/8、12/8：每 3 个八分（附点四分）派生一次', () => {
        for (const sig of ['6/8', '9/8', '12/8']) {
            expect(metricDynamics(0, EIGHTH, sig)).toBe('accent');
            expect(metricDynamics(0.125, EIGHTH, sig)).toBeUndefined();
            expect(metricDynamics(0.25, EIGHTH, sig)).toBeUndefined();
            expect(metricDynamics(0.375, EIGHTH, sig)).toBe('accent');
        }
    });

    it('7/8：按 2+2+3 分组，第 1、3、5 个八分派生', () => {
        expect(metricDynamics(0, EIGHTH, '7/8')).toBe('accent');
        expect(metricDynamics(0.125, EIGHTH, '7/8')).toBeUndefined();
        expect(metricDynamics(0.25, EIGHTH, '7/8')).toBe('accent');
        expect(metricDynamics(0.375, EIGHTH, '7/8')).toBeUndefined();
        expect(metricDynamics(0.5, EIGHTH, '7/8')).toBe('accent');
        expect(metricDynamics(0.625, EIGHTH, '7/8')).toBeUndefined();
    });

    it('非法拍号不派生，也不抛异常', () => {
        for (const sig of ['0/0', '4/0', 'abc', '']) {
            expect(metricDynamics(0, QUARTER, sig)).toBeUndefined();
        }
    });
});

describe('resolveNoteDynamics 优先级', () => {
    it('显式 dynamics 优先于拍位派生', () => {
        expect(resolveNoteDynamics('soft', 0, QUARTER, '4/4')).toBe('soft');
        expect(resolveNoteDynamics('accent', 0.25, QUARTER, '4/4')).toBe('accent');
    });

    it('未标时按拍位派生；开关关闭时不派生', () => {
        expect(resolveNoteDynamics(undefined, 0, QUARTER, '4/4')).toBe('accent');
        expect(resolveNoteDynamics(undefined, 0, QUARTER, '4/4', false)).toBeUndefined();
    });
});

describe('与 classifySlotRole 不漂移', () => {
    it('派生结果始终等价于 strong → accent', () => {
        const cases: Array<[string, number, NoteDuration]> = [
            ['4/4', 0, QUARTER],
            ['4/4', 0.25, QUARTER],
            ['4/4', 0.125, EIGHTH],
            ['3/4', 0.5, QUARTER],
            ['5/4', 0.75, QUARTER],
            ['6/8', 0.375, EIGHTH],
            ['7/8', 0.5, EIGHTH],
            ['9/8', 0.75, EIGHTH],
        ];
        for (const [sig, offset, duration] of cases) {
            const expected = classifySlotRole(offset, duration, sig) === 'strong' ? 'accent' : undefined;
            expect(metricDynamics(offset, duration, sig)).toBe(expected);
        }
    });
});
