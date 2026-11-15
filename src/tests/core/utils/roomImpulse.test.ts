/**
 * generateRoomImpulse — 确定性混响 IR 生成
 */

import { describe, it, expect } from 'vitest';
import { generateRoomImpulse } from '../../../core/utils/roomImpulse.ts';

const BASE = {
    sampleRate: 48000,
    durationSec: 0.2,
    decay: 2.5,
    seed: 42,
};

function rms(data: Float32Array, from: number, to: number): number {
    let sum = 0;
    for (let i = from; i < to; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / Math.max(1, to - from));
}

describe('generateRoomImpulse', () => {
    it('长度与声道数符合参数', () => {
        const ir = generateRoomImpulse(BASE);
        expect(ir).toHaveLength(2);
        expect(ir[0]).toHaveLength(9600);
        expect(ir[1]).toHaveLength(9600);
    });

    it('同种子输出确定，不同声道去相关', () => {
        const a = generateRoomImpulse(BASE);
        const b = generateRoomImpulse(BASE);
        expect(Array.from(a[0])).toEqual(Array.from(b[0]));
        expect(Array.from(a[0])).not.toEqual(Array.from(a[1]));
    });

    it('起音前留白，能量随时间衰减', () => {
        const [left] = generateRoomImpulse(BASE);
        const preDelay = Math.round(BASE.sampleRate * 0.003);
        expect(rms(left, 0, preDelay)).toBe(0);

        const quarter = Math.floor(left.length / 4);
        const early = rms(left, preDelay, preDelay + quarter);
        const late = rms(left, left.length - quarter, left.length);
        expect(early).toBeGreaterThan(late);
    });

    it('decay 越大尾部衰减越快', () => {
        const slow = generateRoomImpulse({ ...BASE, decay: 1 })[0];
        const fast = generateRoomImpulse({ ...BASE, decay: 6 })[0];
        const tailStart = Math.floor(slow.length * 0.75);
        expect(rms(fast, tailStart, fast.length))
            .toBeLessThan(rms(slow, tailStart, slow.length));
    });
});
