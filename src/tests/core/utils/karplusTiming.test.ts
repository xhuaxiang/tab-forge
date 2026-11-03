/**
 * karplusBufferTiming — 变速播放下的缓冲时长拆解
 *
 * 回归重点：推弦抬高 playbackRate 会提前消耗缓冲区。缓冲内容（长度 + sustain）
 * 必须按倍率同步拉长，实时发声长度与停止时刻保持不变。
 */

import { describe, it, expect } from 'vitest';
import { karplusBufferTiming } from '../../../core/utils/karplusTiming.ts';
import { KARPLUS_ARTICULATION } from '../../../core/config.ts';

describe('karplusBufferTiming', () => {
    it('未变速时缓冲与实时时长一致', () => {
        const timing = karplusBufferTiming(0.5);
        expect(timing.soundDur).toBeCloseTo(0.7, 10);
        expect(timing.bufferDur).toBeCloseTo(0.7, 10);
        expect(timing.sustain).toBeCloseTo(0.5, 10);
    });

    it('变速播放只拉长缓冲与衰减时值，实时时长不变', () => {
        const rate = Math.pow(2, 2 / 12); // 一个全音
        const timing = karplusBufferTiming(0.5, rate);
        expect(timing.soundDur).toBeCloseTo(0.7, 10);
        expect(timing.bufferDur).toBeCloseTo(0.7 * rate, 10);
        expect(timing.sustain).toBeCloseTo(0.5 * rate, 10);
    });

    it('倍率小于 1 按 1 处理（缓冲只预拉长、不缩短）', () => {
        const timing = karplusBufferTiming(0.5, 0.5);
        expect(timing.bufferDur).toBeCloseTo(0.7, 10);
        expect(timing.sustain).toBeCloseTo(0.5, 10);
    });

    it('非有限倍率回落到 1，避免污染缓冲长度', () => {
        for (const bad of [NaN, Infinity, -Infinity]) {
            const timing = karplusBufferTiming(0.5, bad);
            expect(Number.isFinite(timing.bufferDur)).toBe(true);
            expect(timing.bufferDur).toBeCloseTo(0.7, 10);
        }
    });

    it('倍率超过上限时封顶', () => {
        const timing = karplusBufferTiming(0.5, 100);
        expect(timing.bufferDur).toBeCloseTo(
            0.7 * KARPLUS_ARTICULATION.maxPlaybackRateScale,
            10,
        );
    });

    it('极短音的实时时长保留下限，衰减时值仍按记谱值', () => {
        const timing = karplusBufferTiming(0.01);
        expect(timing.soundDur).toBeCloseTo(
            KARPLUS_ARTICULATION.minSoundSec + KARPLUS_ARTICULATION.noteTailSec,
            10,
        );
        expect(timing.sustain).toBeCloseTo(0.01, 10);
    });

    it('非有限或负时值回落 / 夹到 0，不产生负的衰减时值', () => {
        for (const bad of [NaN, -0.5]) {
            const timing = karplusBufferTiming(bad);
            expect(Number.isFinite(timing.sustain)).toBe(true);
            expect(timing.sustain).toBe(0);
            expect(timing.soundDur).toBeCloseTo(
                KARPLUS_ARTICULATION.minSoundSec + KARPLUS_ARTICULATION.noteTailSec,
                10,
            );
        }
    });
});
