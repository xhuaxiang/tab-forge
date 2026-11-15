/**
 * semitonesToRate — 半音数 → 频率/播放速率倍率
 */

import { describe, it, expect } from 'vitest';
import { semitonesToRate } from '../../../core/utils/frequency.ts';

describe('semitonesToRate', () => {
    it('零半音不变速，一个八度翻倍，负半音减半', () => {
        expect(semitonesToRate(0)).toBe(1);
        expect(semitonesToRate(12)).toBe(2);
        expect(semitonesToRate(-12)).toBe(0.5);
    });

    it('半音与全音的倍率', () => {
        expect(semitonesToRate(1)).toBeCloseTo(1.059463, 6);
        expect(semitonesToRate(2)).toBeCloseTo(1.122462, 6);
    });
});
