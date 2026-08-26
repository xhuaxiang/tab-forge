/**
 * guitarEngine 冒烟测试
 *
 * 用 mock AudioContext 把 playNote 的完整信号链跑一遍：
 * generateStringData → toAudioBuffer → source 播放。
 * 验证重构后浏览器侧接线没有静音/抛错。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GuitarEngine } from './guitarEngine.ts';

// ---- 最小 AudioContext mock ----
class MockParam {
    value: number;
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v: number) { this.value = v; }
    exponentialRampToValueAtTime(v: number) { this.value = v; }
    cancelScheduledValues() {}
}

class MockNode {
    frequency = new MockParam(440);
    gain = new MockParam(1);
    Q = new MockParam(0);
    delayTime = new MockParam(0);
    playbackRate = new MockParam(1);
    type = '';
    buffer: MockBuffer | null = null;

    connect() {}
    disconnect() {}
    start() {}
    stop() {}
}

class MockBuffer {
    length: number;
    sampleRate: number;
    numberOfChannels: number;
    private data: Float32Array;
    constructor(channels: number, length: number, sampleRate: number) {
        this.numberOfChannels = channels;
        this.length = length;
        this.sampleRate = sampleRate;
        this.data = new Float32Array(length);
    }
    // 必须返回同一实例，否则 .set() 与断言读到的是两个数组
    getChannelData(): Float32Array { return this.data; }
}

class MockAudioContext {
    currentTime = 0;
    sampleRate = 44100;
    state = 'running';
    destination = new MockNode();
    private sources: MockNode[] = [];

    createGain() { return new MockNode(); }
    createBufferSource() { const n = new MockNode(); this.sources.push(n); return n; }
    createBiquadFilter() { return new MockNode(); }
    createDelay() { return new MockNode(); }
    createOscillator() { return new MockNode(); }
    createBuffer(channels: number, length: number, sampleRate: number) {
        return new MockBuffer(channels, length, sampleRate);
    }
    resume() {}
    close() {}

    /** 测试辅助：拿到已赋值的 source buffer */
    getSourceBuffers(): MockBuffer[] {
        return this.sources.map(s => s.buffer).filter((b): b is MockBuffer => b !== null);
    }
}

function rms(d: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    return Math.sqrt(sum / d.length);
}

describe('GuitarEngine.playNote', () => {
    beforeEach(() => {
        (globalThis as Record<string, unknown>).window = { AudioContext: MockAudioContext };
    });

    it('生成非静音缓冲区并交给 source 播放（浏览器接线冒烟）', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        ge.playNote({ frequency: 440, duration: 0.5, volume: 0.5, string: 1 });

        const buffers = ctx.getSourceBuffers();
        expect(buffers.length).toBeGreaterThan(0);
        expect(buffers[0].length).toBeGreaterThan(1000); // 非 1 采样空缓冲
        expect(rms(buffers[0].getChannelData())).toBeGreaterThan(0); // 非静音

        ge.dispose();
    });

    it('频率无效时短路返回，不产生 source', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        ge.playNote({ frequency: 0, duration: 0.5, string: 1 });

        expect(ctx.getSourceBuffers()).toHaveLength(0);
        ge.dispose();
    });
});
