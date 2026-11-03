/**
 * karplusMix — 弦号到高通分频 / 声像的纯换算
 */

import { describe, it, expect } from 'vitest';
import { highpassHzForString, panForString } from '../../../core/utils/karplusMix.ts';
import { KARPLUS_MIX } from '../../../core/config.ts';

describe('highpassHzForString', () => {
    it('按低 / 中 / 高弦分段', () => {
        expect(highpassHzForString(6)).toBe(KARPLUS_MIX.highpassLowStringHz);
        expect(highpassHzForString(5)).toBe(KARPLUS_MIX.highpassLowStringHz);
        expect(highpassHzForString(4)).toBe(KARPLUS_MIX.highpassMidStringHz);
        expect(highpassHzForString(3)).toBe(KARPLUS_MIX.highpassMidStringHz);
        expect(highpassHzForString(2)).toBe(KARPLUS_MIX.highpassHighStringHz);
        expect(highpassHzForString(1)).toBe(KARPLUS_MIX.highpassHighStringHz);
    });

    it('缺省弦号回退中弦', () => {
        expect(highpassHzForString(undefined)).toBe(KARPLUS_MIX.highpassMidStringHz);
    });
});

describe('panForString', () => {
    it('低弦偏左、高弦偏右，中心弦为 0', () => {
        expect(panForString(6)).toBeCloseTo(-0.2, 5);
        expect(panForString(1)).toBeCloseTo(0.2, 5);
        expect(panForString(KARPLUS_MIX.panCenterString)).toBeCloseTo(0, 5);
        expect(panForString(undefined)).toBe(0);
    });

    it('超出弦号范围时钳制在 [-1, 1]', () => {
        expect(panForString(100)).toBe(-1);
        expect(panForString(-100)).toBe(1);
    });
});
