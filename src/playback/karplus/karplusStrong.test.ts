/**
 * karplusStrong 单元测试
 *
 * 算法层是纯函数（输出 Float32Array），因此可直接在 Node 中验证：
 * 输出契约、能量衰减、闷音、滤波器参数、AudioBuffer 包装。
 */

import { describe, it, expect } from 'vitest';
import { generateStringData, toAudioBuffer, getBodyFilterPreset } from './karplusStrong.ts';

// BaseAudioContext 为 DOM 全局类型，测试中只用一个最小伪造对象验证包装逻辑

const SR = 44100;

describe('generateStringData', () => {
    it('返回带 sampleRate 的 Float32Array 数据', () => {
        const ks = generateStringData({ frequency: 110, duration: 0.5, sampleRate: SR, string: 6 });
        expect(ks.data).toBeInstanceOf(Float32Array);
        expect(ks.sampleRate).toBe(SR);
    });

    it('输出长度至少覆盖请求时值，且不超时值+0.06s', () => {
        const duration = 0.5;
        const ks = generateStringData({ frequency: 440, duration, sampleRate: SR, string: 1 });
        expect(ks.data.length).toBeGreaterThanOrEqual(Math.round(SR * duration));
        expect(ks.data.length).toBeLessThanOrEqual(Math.round(SR * (duration + 0.06)) + 2);
    });

    it('频率无效时返回 1 采样静音（无 AudioContext 副作用）', () => {
        const ks = generateStringData({ frequency: 0, duration: 0.5, sampleRate: SR });
        expect(ks.data.length).toBe(1);
        expect(ks.data[0]).toBe(0);
        expect(ks.duration).toBe(0);
    });

    it('输出能量随时间衰减（拨弦瞬态后音量下降）', () => {
        const ks = generateStringData({ frequency: 330, duration: 1, sampleRate: SR, string: 3 });
        const { data } = ks;
        const rms = (from: number, to: number) => {
            let sum = 0;
            let n = 0;
            for (let i = from; i < to; i++) { sum += data[i] * data[i]; n++; }
            return Math.sqrt(sum / n);
        };
        const head = rms(0, Math.floor(SR * 0.1));
        const tail = rms(Math.floor(SR * 0.9), SR);
        expect(tail).toBeLessThan(head * 0.5);
    });

    it('输出无 NaN 且振幅有界', () => {
        const ks = generateStringData({ frequency: 220, duration: 0.3, sampleRate: SR, string: 5 });
        for (const v of ks.data) {
            expect(Number.isFinite(v)).toBe(true);
            expect(Math.abs(v)).toBeLessThanOrEqual(1.4);
        }
    });

    it('闷音在 0.5s 处能量显著低于正常音', () => {
        const normal = generateStringData({ frequency: 220, duration: 1, sampleRate: SR, string: 4 });
        const muted = generateStringData({ frequency: 220, duration: 1, sampleRate: SR, string: 4, mute: true });
        const idx = Math.round(SR * 0.5);
        const rms = (d: Float32Array, from: number, to: number) => {
            let sum = 0;
            let n = 0;
            for (let i = from; i < to; i++) { sum += d[i] * d[i]; n++; }
            return Math.sqrt(sum / n);
        };
        expect(rms(muted.data, idx, idx + SR * 0.05)).toBeLessThan(
            rms(normal.data, idx, idx + SR * 0.05),
        );
    });
});

describe('getBodyFilterPreset', () => {
    it('低音弦低通频率更低（更暖）、高音弦更高（更亮）', () => {
        const low = getBodyFilterPreset(6);
        const high = getBodyFilterPreset(1);
        expect(low.lowpassFreq).toBeLessThan(high.lowpassFreq);
    });

    it('低音弦琴体共振增益更低,避免 200Hz 处过"轰"', () => {
        const low = getBodyFilterPreset(6);
        const high = getBodyFilterPreset(1);
        expect(low.resonanceGain).toBeLessThan(high.resonanceGain);
    });
});

describe('toAudioBuffer', () => {
    it('把裸数据逐采样包装进 AudioBuffer', () => {
        const ks = generateStringData({ frequency: 440, duration: 0.1, sampleRate: SR, string: 1 });
        const fakeCtx = {
            createBuffer(channels: number, length: number, sampleRate: number) {
                // getChannelData 需返回同一实例，否则 .set() 与断言读到的是两个数组
                const data = new Float32Array(length);
                return {
                    length,
                    sampleRate,
                    numberOfChannels: channels,
                    getChannelData: () => data,
                };
            },
        } as unknown as BaseAudioContext;
        const buffer = toAudioBuffer(fakeCtx, ks);
        expect(buffer.length).toBe(ks.data.length);
        expect(buffer.getChannelData(0)).toEqual(ks.data);
    });
});
