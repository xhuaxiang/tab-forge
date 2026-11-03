/**
 * guitarEngine 冒烟测试
 *
 * 用 mock AudioContext 把 playNote 的完整信号链跑一遍：
 * generateStringData → toAudioBuffer → source 播放。
 * 验证重构后浏览器侧接线没有静音/抛错。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuitarEngine } from '../../../../features/playback/karplus/guitarEngine.ts';
import { generateStringData } from '../../../../features/playback/karplus/karplusStrong.ts';
import { KARPLUS_ARTICULATION, KARPLUS_MIX } from '../../../../core/config.ts';

// ---- 最小 AudioContext mock ----
/** 全局模拟时钟：AudioParam.value 按当前时刻计算，而不是简单返回最后写入值 */
let mockNow = 0;

interface MockEvent {
    time: number;
    value: number;
    ramp: boolean;
    /** ramp 的调用时刻与当时电平；无前置事件时按规范从调用时刻起算 */
    startTime?: number;
    startValue?: number;
}

class MockParam {
    /** 直接赋值（param.value = x）的固有值 */
    private intrinsic: number;
    /** 记录 setValueAtTime 的调度值（dampNote 断言用） */
    scheduled: number[] = [];
    /** 记录 ramp 目标值（推弦/滑弦/释放包络断言用） */
    ramps: number[] = [];
    /** 记录 ramp 的目标值与绝对时间（短音缩放断言用） */
    rampEvents: Array<{ value: number; time: number }> = [];
    /** 真实语义的自动化事件表：cancel 只删 >= 指定时间的事件 */
    private events: MockEvent[] = [];

    constructor(v = 0) { this.intrinsic = v; }

    get value(): number { return this.valueAt(mockNow); }
    set value(v: number) { this.intrinsic = v; }

    setValueAtTime(v: number, t: number) {
        this.scheduled.push(v);
        this.events.push({ time: t, value: v, ramp: false });
    }
    // 真实 AudioParam 的 ramp 不会立刻改写当前值；valueAt 按时间插值
    exponentialRampToValueAtTime(v: number, t: number) {
        this.ramps.push(v);
        this.rampEvents.push({ value: v, time: t });
        this.events.push({
            time: t,
            value: v,
            ramp: true,
            startTime: mockNow,
            startValue: this.valueAt(mockNow),
        });
    }
    linearRampToValueAtTime(v: number, t: number) {
        this.ramps.push(v);
        this.rampEvents.push({ value: v, time: t });
        this.events.push({
            time: t,
            value: v,
            ramp: true,
            startTime: mockNow,
            startValue: this.valueAt(mockNow),
        });
    }
    cancelScheduledValues(t: number) {
        this.events = this.events.filter(e => e.time < t);
    }
    cancelAndHoldAtTime(t: number) {
        // 规范：没有需要取消的事件时是 no-op，不会凭空插入 hold
        if (!this.events.some(e => e.time >= t)) return;
        const held = this.valueAt(t);
        this.events = this.events.filter(e => e.time < t);
        this.events.push({ time: t, value: held, ramp: false });
    }
    /** 清空断言日志（事件表保留，模拟真实参数状态） */
    clearLog() { this.scheduled = []; this.ramps = []; }

    /** 最近一次 ramp 的起点电平（验证 read-before-cancel 用） */
    get lastRampStart(): number | undefined {
        return [...this.events].reverse().find(e => e.ramp)?.startValue;
    }

    private valueAt(t: number): number {
        let value = this.intrinsic;
        let lastTime = -Infinity;
        let lastValue = value;
        const sorted = [...this.events].sort((a, b) => a.time - b.time);
        for (const e of sorted) {
            if (e.time <= t) {
                value = e.value;
                lastTime = e.time;
                lastValue = e.value;
            } else if (e.ramp) {
                // 无前置事件时，ramp 从调用时刻的固有值起算（真实规范行为）
                const startTime = lastTime === -Infinity ? (e.startTime ?? 0) : lastTime;
                const startValue = lastTime === -Infinity ? (e.startValue ?? value) : lastValue;
                if (t <= startTime) return startValue;
                const p = (t - startTime) / (e.time - startTime);
                if (startValue > 0 && e.value > 0) {
                    return startValue * Math.pow(e.value / startValue, p);
                }
                return startValue + (e.value - startValue) * p;
            } else {
                break;
            }
        }
        return value;
    }
}

class MockNode {
    frequency = new MockParam(440);
    gain = new MockParam(1);
    Q = new MockParam(0);
    playbackRate = new MockParam(1);
    pan = new MockParam(0);
    threshold = new MockParam(-24);
    knee = new MockParam(30);
    ratio = new MockParam(12);
    attack = new MockParam(0.003);
    release = new MockParam(0.25);
    type = '';
    normalize = true;
    buffer: MockBuffer | null = null;
    /** 记录 source.stop 的绝对时间，验证先 ramp 再 stop */
    stoppedAt: number[] = [];
    /** 记录 connect 的目标，用于验证总线/发送接线 */
    connectedTo: MockNode[] = [];

    connect(target?: MockNode) {
        if (target) this.connectedTo.push(target);
    }
    disconnect() { this.connectedTo = []; }
    start() {}
    stop(t?: number) { this.stoppedAt.push(t ?? 0); }
}

class MockBuffer {
    length: number;
    sampleRate: number;
    numberOfChannels: number;
    /** 按声道独立存储：与真实 AudioBuffer 一致，写错声道能被断言发现 */
    private data: Float32Array[];
    constructor(channels: number, length: number, sampleRate: number) {
        this.numberOfChannels = channels;
        this.length = length;
        this.sampleRate = sampleRate;
        this.data = Array.from({ length: channels }, () => new Float32Array(length));
    }
    // 必须返回同一实例，否则 .set() 与断言读到的是两个数组
    getChannelData(channel = 0): Float32Array { return this.data[channel]; }
}

class MockAudioContext {
    /** 与 MockParam 共用的模拟时钟 */
    get currentTime(): number { return mockNow; }
    set currentTime(v: number) { mockNow = v; }
    sampleRate = 44100;
    state = 'running';
    destination = new MockNode();
    private sources: MockNode[] = [];
    private gains: MockNode[] = [];
    private filters: MockNode[] = [];
    private oscillators: MockNode[] = [];
    private compressors: MockNode[] = [];
    private convolvers: MockNode[] = [];
    private panners: MockNode[] = [];

    createGain() { const n = new MockNode(); this.gains.push(n); return n; }
    createBufferSource() { const n = new MockNode(); this.sources.push(n); return n; }
    createBiquadFilter() { const n = new MockNode(); this.filters.push(n); return n; }
    createOscillator() { const n = new MockNode(); this.oscillators.push(n); return n; }
    createDynamicsCompressor() { const n = new MockNode(); this.compressors.push(n); return n; }
    createConvolver() { const n = new MockNode(); this.convolvers.push(n); return n; }
    createStereoPanner() { const n = new MockNode(); this.panners.push(n); return n; }
    createBuffer(channels: number, length: number, sampleRate: number) {
        return new MockBuffer(channels, length, sampleRate);
    }
    resume() {}
    close() {}

    /** 测试辅助：拿到已赋值的 source buffer */
    getSourceBuffers(): MockBuffer[] {
        return this.sources.map(s => s.buffer).filter((b): b is MockBuffer => b !== null);
    }

    /** 测试辅助：拿到按创建顺序排列的 source（读 playbackRate 用） */
    getSources(): MockNode[] { return this.sources; }

    /** 测试辅助：gains[0..2] 是总线，之后每个音 mixGain/envGain/panComp 三连 */
    getGains(): MockNode[] { return this.gains; }

    /** 按角色取总线节点，避免测试依赖创建顺序 */
    getMasterGain(): MockNode { return this.gains[0]; }
    getReverbSend(): MockNode { return this.gains[1]; }
    getReverbReturn(): MockNode { return this.gains[2]; }
    getLastGain(): MockNode { return this.gains[this.gains.length - 1]; }

    /** 测试辅助：第 index 个音符的 mixGain / envGain / 声像补偿 */
    getMixGain(index = 0): MockNode { return this.gains[3 + index * 3]; }
    getEnvGain(index = 0): MockNode { return this.gains[4 + index * 3]; }
    getPanComp(index = 0): MockNode { return this.gains[5 + index * 3]; }

    /** 测试辅助：每个音按顺序创建 highpass / bodyFilter / resonance */
    getFilters(): MockNode[] { return this.filters; }

    /** 测试辅助：揉弦 LFO */
    getOscillators(): MockNode[] { return this.oscillators; }

    getCompressors(): MockNode[] { return this.compressors; }
    getConvolvers(): MockNode[] { return this.convolvers; }
    getPanners(): MockNode[] { return this.panners; }
}

function rms(d: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    return Math.sqrt(sum / d.length);
}

/** 确定性随机数：KS 激励用 Math.random，逐样本比对需要可复现的缓冲内容 */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

describe('GuitarEngine.playNote', () => {
    beforeEach(() => {
        mockNow = 0;
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

    it('手掌闷音：琴体低通被压到 config 上限，且不加混响', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        ge.playNote({ frequency: 82, duration: 0.4, volume: 0.5, string: 6, palmMute: true });

        const bodyFilter = ctx.getFilters()[1];
        // 6 弦预设 2500Hz，被 palmMuteLowpassFreq=1800 压住
        expect(bodyFilter.frequency.value).toBe(1800);
        // 闷音不送共享混响
        expect(ctx.getEnvGain().connectedTo).not.toContain(ctx.getReverbSend());
        ge.dispose();
    });

    it('初始化建立 master → 限幅 → destination，并配置共享混响总线', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        const master = ctx.getMasterGain();
        const limiter = ctx.getCompressors()[0];
        expect(master.connectedTo).toContain(limiter);
        expect(limiter.connectedTo).toContain(ctx.destination);
        expect(limiter.threshold.value).toBe(KARPLUS_MIX.limiterThresholdDb);
        expect(limiter.knee.value).toBe(KARPLUS_MIX.limiterKneeDb);
        expect(limiter.ratio.value).toBe(KARPLUS_MIX.limiterRatio);
        expect(limiter.attack.value).toBe(KARPLUS_MIX.limiterAttackSec);
        expect(limiter.release.value).toBe(KARPLUS_MIX.limiterReleaseSec);

        // 混响：send → convolver(IR) → return(湿声电平) → master
        const convolver = ctx.getConvolvers()[0];
        expect(ctx.getReverbSend().connectedTo).toContain(convolver);
        expect(convolver.connectedTo).toContain(ctx.getReverbReturn());
        expect(ctx.getReverbReturn().connectedTo).toContain(master);
        expect(ctx.getReverbReturn().gain.value).toBe(KARPLUS_MIX.roomWet);
        expect(convolver.buffer).not.toBeNull();
        expect(convolver.buffer!.length).toBe(
            Math.round(ctx.sampleRate * KARPLUS_MIX.roomDurationSec),
        );
        expect(convolver.buffer!.numberOfChannels).toBe(2);
        // 两个声道的 IR 必须各自写入：跳过 pre-delay 的空白后应各不相同
        // （去相关后折叠单声道才不梳状滤波）
        const irStart = Math.round(ctx.sampleRate * KARPLUS_MIX.roomPreDelaySec) + 64;
        const leftIr = convolver.buffer!.getChannelData(0);
        const rightIr = convolver.buffer!.getChannelData(1);
        // 两个声道都必须真有内容，避免“右声道全零”也满足去相关断言
        expect(rms(leftIr)).toBeGreaterThan(0);
        expect(rms(rightIr)).toBeGreaterThan(0);
        expect(leftIr.slice(irStart, irStart + 128))
            .not.toEqual(rightIr.slice(irStart, irStart + 128));
        ge.dispose();
    });

    it('每个音符经三频段琴体后按弦号声像进入总线', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        ge.playNote({ frequency: 82, duration: 0.4, volume: 0.5, string: 6 });
        ge.playNote({ frequency: 330, duration: 0.4, volume: 0.5, string: 1 });

        const [lowHighpass, lowBody, lowResonance] = ctx.getFilters();
        expect(lowHighpass.type).toBe('highpass');
        expect(lowHighpass.frequency.value).toBe(KARPLUS_MIX.highpassLowStringHz);
        expect(lowHighpass.Q.value).toBe(KARPLUS_MIX.highpassQ);
        expect(lowBody.type).toBe('lowpass');
        expect(lowResonance.type).toBe('peaking');

        const [highHighpass] = ctx.getFilters().slice(3);
        expect(highHighpass.frequency.value).toBe(KARPLUS_MIX.highpassHighStringHz);

        // 6 弦偏左、1 弦偏右，偏移量对称
        const [lowPan, highPan] = ctx.getPanners();
        expect(lowPan.pan.value).toBeCloseTo((KARPLUS_MIX.panCenterString - 6) * KARPLUS_MIX.panStep, 5);
        expect(highPan.pan.value).toBeCloseTo((KARPLUS_MIX.panCenterString - 1) * KARPLUS_MIX.panStep, 5);
        expect(lowPan.pan.value).toBeLessThan(0);
        expect(highPan.pan.value).toBeGreaterThan(0);
        expect(lowPan.pan.value).toBeCloseTo(-highPan.pan.value, 5);
        ge.dispose();
    });

    it('普通音符把包络输出送进共享混响总线', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        ge.playNote({ frequency: 330, duration: 0.4, volume: 0.5, string: 1 });

        expect(ctx.getEnvGain().connectedTo).toContain(ctx.getReverbSend());
        // 干声经声像进入 master，湿声经 reverbReturn 回到 master
        expect(ctx.getPanners()[0].connectedTo).toContain(ctx.getPanComp());
        expect(ctx.getPanComp().connectedTo).toContain(ctx.getMasterGain());
        expect(ctx.getPanComp().gain.value).toBeCloseTo(KARPLUS_MIX.panCompensationGain, 5);
        ge.dispose();
    });

    it('stopAll 压掉共享混响尾音，重新播放时用 ramp 恢复湿声', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        ge.playNote({ frequency: 220, duration: 0.5, volume: 0.5, string: 4 });

        const reverbReturn = ctx.getReverbReturn();
        mockNow = 0.2;
        ge.stopAll();

        const fade = reverbReturn.gain.rampEvents.at(-1)!;
        expect(fade.value).toBeCloseTo(0.0001, 5);
        expect(fade.time).toBeCloseTo(0.2 + KARPLUS_MIX.roomStopFadeSec, 5);

        // 压降途中再次 stopAll：起点应取当前电平，而不是跳回 roomWet
        mockNow = 0.21;
        const midFade = reverbReturn.gain.value;
        expect(midFade).toBeLessThan(KARPLUS_MIX.roomWet);
        reverbReturn.gain.clearLog();
        ge.stopAll();
        expect(reverbReturn.gain.scheduled[0]).toBeCloseTo(midFade, 5);

        // 下一次播放（audioEngine.play → init）用短 ramp 恢复，不把旧尾音瞬间抬回来
        mockNow = 0.5;
        ge.init();
        const restore = reverbReturn.gain.rampEvents.at(-1)!;
        expect(restore.value).toBeCloseTo(KARPLUS_MIX.roomWet, 5);
        expect(restore.time).toBeCloseTo(0.5 + KARPLUS_MIX.roomStopFadeSec, 5);
        mockNow = 0.5 + KARPLUS_MIX.roomStopFadeSec;
        expect(reverbReturn.gain.value).toBeCloseTo(KARPLUS_MIX.roomWet, 5);
        ge.dispose();
    });

    it('stopAll 后直接调用 playNote 也会恢复湿声（不依赖 init）', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        ge.playNote({ frequency: 220, duration: 0.5, volume: 0.5, string: 4 });

        mockNow = 0.2;
        ge.stopAll();
        mockNow = 0.5;
        ge.playNote({ frequency: 247, duration: 0.2, volume: 0.5, string: 3 });

        const restore = ctx.getReverbReturn().gain.rampEvents.at(-1)!;
        expect(restore.value).toBeCloseTo(KARPLUS_MIX.roomWet, 5);
        expect(restore.time).toBeCloseTo(0.5 + KARPLUS_MIX.roomStopFadeSec, 5);
        ge.dispose();
    });

    it('压降途中重播，恢复 ramp 从当前电平起步（不跳回 roomWet）', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        ge.playNote({ frequency: 220, duration: 0.5, volume: 0.5, string: 4 });

        mockNow = 0.2;
        ge.stopAll();
        // 压降进行中（0.2 → 0.23），此刻重播
        mockNow = 0.21;
        const midFade = ctx.getReverbReturn().gain.value;
        expect(midFade).toBeLessThan(KARPLUS_MIX.roomWet);

        ge.playNote({ frequency: 247, duration: 0.2, volume: 0.5, string: 3 });

        // 先读当前电平再 cancel：恢复应从 midFade 起升，而不是从 roomWet 跳过去
        expect(ctx.getReverbReturn().gain.lastRampStart).toBeCloseTo(midFade, 5);
        ge.dispose();
    });

    it('bendNote：按半音数把 playbackRate 弯到 2^(n/12)，释放时回到原速', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        const noteId = ge.playNote({ frequency: 440, duration: 0.5, volume: 0.5, string: 1 });
        ge.bendNote(noteId, 2, 0.5, true);

        const rate = ctx.getSources()[0].playbackRate;
        expect(rate.ramps[0]).toBeCloseTo(Math.pow(2, 2 / 12), 5); // 上弯 2 个半音
        expect(rate.ramps[rate.ramps.length - 1]).toBeCloseTo(1, 5); // 释放回原音高
        ge.dispose();
    });

    it('playNote：变速播放按倍率拉长缓冲，停止时刻仍按实时时长', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        // 推弦到 2 个半音：播放速率最高 2^(2/12)，缓冲内容同步拉长
        const rateScale = Math.pow(2, 2 / 12);
        const soundDur = 0.5 + KARPLUS_ARTICULATION.noteTailSec;
        const noteId = ge.playNote({
            frequency: 220, duration: 0.5, volume: 0.5, string: 3,
            playbackRateScale: rateScale,
        });

        const expectedSamples = Math.round(ctx.sampleRate * soundDur * rateScale);
        expect(Math.abs(ctx.getSourceBuffers()[0].length - expectedSamples)).toBeLessThanOrEqual(2);
        // 实时发声时长不跟着拉长：duration + 尾音
        expect(ctx.getSources()[0].stoppedAt[0]).toBeCloseTo(soundDur, 5);
        // audibleUntil 同样按实时时长失效，而不是按拉长后的缓冲长度
        mockNow = soundDur - 0.01;
        expect(ge.isNoteActive(noteId)).toBe(true);
        mockNow = soundDur + 0.01;
        expect(ge.isNoteActive(noteId)).toBe(false);
        ge.dispose();
    });

    it('playNote：未指定变速倍率时缓冲长度保持原值', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        ge.playNote({ frequency: 220, duration: 0.5, volume: 0.5, string: 3 });

        const expectedSamples = Math.round(
            ctx.sampleRate * (0.5 + KARPLUS_ARTICULATION.noteTailSec),
        );
        expect(Math.abs(ctx.getSourceBuffers()[0].length - expectedSamples)).toBeLessThanOrEqual(2);
        ge.dispose();
    });

    it('playNote：缓冲预拉长时 sustain 同步放大，衰减不会提前收干', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const duration = 0.7;
        const rateScale = Math.pow(2, 2 / 12);

        let actual: Float32Array;
        const renderSpy = vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
        try {
            ge.playNote({
                frequency: 220, duration, volume: 0.5, string: 3,
                playbackRateScale: rateScale,
            });
            actual = ctx.getSourceBuffers()[0].getChannelData().slice();
        } finally {
            renderSpy.mockRestore();
        }

        // 期望：长度与 sustain 一起按倍率拉长后的 KS 输出。
        // 若漏掉 sustain 缩放，衰减按实时时值提前收干，后半段电平会明显偏低。
        let expected: Float32Array;
        const expectedSpy = vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
        try {
            expected = generateStringData({
                frequency: 220,
                duration: (duration + KARPLUS_ARTICULATION.noteTailSec) * rateScale,
                sustain: duration * rateScale,
                sampleRate: ctx.sampleRate,
                string: 3,
            }).data;
        } finally {
            expectedSpy.mockRestore();
        }

        expect(actual.length).toBe(expected.length);
        let maxDiff = 0;
        for (let i = 0; i < actual.length; i++) {
            maxDiff = Math.max(maxDiff, Math.abs(actual[i] - expected[i]));
        }
        expect(maxDiff).toBeLessThan(1e-6);
        ge.dispose();
    });

    it('playNote 在结束前安排 gain 淡出，再停止 source', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        ge.playNote({ frequency: 440, duration: 0.5, volume: 0.5, string: 1 });

        const envGain = ctx.getEnvGain();
        expect(envGain.gain.ramps).toContain(0.001); // 释音包络已排期
        // 释音在收尾前才启动：音符中段（0.35s）包络仍应为满值
        mockNow = 0.35;
        expect(envGain.gain.value).toBeCloseTo(1, 5);
        const source = ctx.getSources()[0];
        expect(source.stoppedAt).toHaveLength(1);
        expect(source.stoppedAt[0]).toBeCloseTo(0.7, 5); // 时值 0.5 + 尾音 0.2
        ge.dispose();
    });

    it('stopNote 先安排 gain 淡出，再把 source.stop 推后到淡出结束', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const noteId = ge.playNote({ frequency: 440, duration: 0.5, volume: 0.5, string: 1 });
        const mixGain = ctx.getMixGain();
        const source = ctx.getSources()[0];
        // 清掉 playNote 的原有排期日志，只看 stopNote 自己做了什么
        source.stoppedAt.length = 0;
        mixGain.gain.clearLog();

        ge.stopNote(noteId);

        expect(mixGain.gain.ramps).toContain(0.001);
        expect(source.stoppedAt[0]).toBeCloseTo(KARPLUS_ARTICULATION.releaseSec + 0.005, 5);
        ge.dispose();
    });

    it('stopNote 在 gain 淡出进行中读取当前电平，不因 cancel 回跳到原始音量', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const noteId = ge.playNote({ frequency: 440, duration: 0.5, volume: 0.5, string: 1 });
        const mixGain = ctx.getMixGain();
        // dampNote 在 0.1s 后开始淡出、0.13s 结束；0.12s 正处在淡出中段
        ge.dampNote(noteId, 0.1);
        mockNow = 0.12;
        const duringFade = mixGain.gain.value;
        expect(duringFade).toBeLessThan(0.2); // 已明显低于 0.5
        mixGain.gain.clearLog();

        ge.stopNote(noteId);

        // stop 的起点应是淡出中的当前电平，而不是 0.5
        expect(mixGain.gain.scheduled[0]).toBeCloseTo(duringFade, 3);
        expect(mixGain.gain.scheduled[0]).toBeLessThan(0.2);
        ge.dispose();
    });

    it('dampNote：技法连接后把闷音作用到当前发声的音符上', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        const noteId = ge.playNote({ frequency: 220, duration: 0.4, volume: 0.5, string: 4 });
        const mixGain = ctx.getMixGain();
        const before = mixGain.gain.value;

        ge.dampNote(noteId, 0.1, 0.7, true);

        // 第一次 setValueAtTime 是音量系数后的电平，之后 ramp 到 0.001 收尾
        expect(mixGain.gain.scheduled[0]).toBeCloseTo(before * 0.7, 5);
        expect(ctx.getFilters()[1].frequency.ramps).toContain(1800);
        ge.dispose();
    });

    it('技法增益以调度音量为基准，不再覆盖成绝对值', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const noteId = ge.playNote({ frequency: 220, duration: 0.5, volume: 0.4, string: 4 });
        const mixGain = ctx.getMixGain();

        mixGain.gain.clearLog();
        ge.hammerOn(247, noteId);
        expect(mixGain.gain.scheduled[0]).toBeCloseTo(
            0.4 * KARPLUS_ARTICULATION.hammerOnVolumeFactor,
            5,
        );

        mixGain.gain.clearLog();
        ge.pullOff(220, noteId);
        expect(mixGain.gain.scheduled[0]).toBeCloseTo(
            0.4 * KARPLUS_ARTICULATION.pullOffVolumeFactor,
            5,
        );

        mixGain.gain.clearLog();
        ge.slideTo(247, 0.1, noteId);
        expect(mixGain.gain.scheduled[0]).toBeCloseTo(
            0.4 * KARPLUS_ARTICULATION.slideVolumeFactor,
            5,
        );

        mixGain.gain.clearLog();
        ge.bendNote(noteId, 2, 0.5);
        expect(mixGain.gain.scheduled[0]).toBeCloseTo(
            0.4 * KARPLUS_ARTICULATION.bendVolumeFactor,
            5,
        );
        ge.dispose();
    });

    it('16 分推弦在音符结束前到达目标音高', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const hold = 0.125;
        const noteId = ge.playNote({ frequency: 220, duration: hold, string: 4 });
        const rate = ctx.getSources()[0].playbackRate;
        rate.rampEvents.length = 0;

        ge.bendNote(noteId, 2, hold, true);

        const peak = rate.rampEvents.find(e => e.value > 1);
        expect(peak).toBeDefined();
        expect(peak!.time).toBeLessThan(hold);
        // 起始延迟与上弯都按 16 分时值压缩：0.025 + 0.0625
        expect(peak!.time).toBeCloseTo(0.0875, 5);

        // 回弹也要在记谱结束前完成，不能拖到下一个音
        const release = rate.rampEvents.at(-1)!;
        expect(release.value).toBeCloseTo(1, 5);
        expect(release.time).toBeCloseTo(0.0875 + 0.125 * 0.2, 5);
        expect(release.time).toBeLessThanOrEqual(hold);
        ge.dispose();
    });

    it('连续技法链从当前速率继续滑动，不会跳回原始音高', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const [a, b, c] = [220, 246.94, 293.66];

        const noteId = ge.playNote({ frequency: a, duration: 2, volume: 0.5, string: 4 });
        const rate = ctx.getSources()[0].playbackRate;

        mockNow = 0.5;
        ge.hammerOn(b, noteId);
        mockNow = 1.0;
        ge.pullOff(c, noteId);

        // 第二段从 B/A 起滑，最终应为相对源缓冲区的 C/A
        expect(rate.ramps.at(-1)).toBeCloseTo(c / a, 3);
        ge.dispose();
    });

    it('上一段滑动未完成时，下一段仍落在绝对目标音高', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const [a, b, c] = [220, 246.94, 293.66];
        const noteId = ge.playNote({ frequency: a, duration: 2, volume: 0.5, string: 4 });

        mockNow = 0.5;
        ge.hammerOn(b, noteId);
        // 击弦滑动（0.025s）还没走完就接勾弦
        mockNow = 0.505;
        ge.pullOff(c, noteId);

        // 终点必须按缓冲区原始音高绝对换算，不能相对中途的当前速率累乘
        const rate = ctx.getSources()[0].playbackRate;
        expect(rate.ramps.at(-1)).toBeCloseTo(c / a, 3);
        ge.dispose();
    });

    it('推弦回弹后音高回到缓冲区原始值', () => {
        const ge = new GuitarEngine();
        ge.init();
        const noteId = ge.playNote({ frequency: 220, duration: 0.5, volume: 0.5, string: 4 });

        ge.bendNote(noteId, 2, 0.5, true);
        expect(ge.getNoteFrequency(noteId)).toBeCloseTo(220, 5);

        const other = ge.playNote({ frequency: 330, duration: 0.5, volume: 0.5, string: 4 });
        expect(ge.getNoteFrequency(other)).toBeCloseTo(330, 5);
        ge.dispose();
    });

    it('32 分推弦的回弹不拖过记谱结束', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const hold = 0.03125;
        const noteId = ge.playNote({ frequency: 220, duration: hold, string: 4 });
        const rate = ctx.getSources()[0].playbackRate;
        rate.rampEvents.length = 0;

        ge.bendNote(noteId, 2, hold, true);

        const release = rate.rampEvents.at(-1)!;
        expect(release.value).toBeCloseTo(1, 5);
        expect(release.time).toBeLessThanOrEqual(hold + 1e-9);
        ge.dispose();
    });

    it('连接技法复用前会停掉源音上的揉弦 LFO', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const noteId = ge.playNote({ frequency: 220, duration: 1, volume: 0.5, string: 4 });
        ge.vibrato(noteId, 0.01, 5.5, 0, 1);
        const lfo = ctx.getOscillators()[0];
        expect(lfo.stoppedAt).toHaveLength(0);

        ge.hammerOn(247, noteId);
        expect(lfo.stoppedAt.length).toBeGreaterThan(0);
        ge.dispose();
    });

    it('短音揉弦提高速率并做深度渐入', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const hold = 0.125;
        const noteId = ge.playNote({ frequency: 220, duration: hold, string: 4 });

        ge.vibrato(noteId, KARPLUS_ARTICULATION.vibratoDepth, KARPLUS_ARTICULATION.vibratoRate,
            KARPLUS_ARTICULATION.vibratoStartSec, hold);

        // 1.5 个周期 / 0.125s = 12Hz，正好触到上限
        const lfo = ctx.getOscillators()[0];
        expect(lfo.frequency.value).toBeCloseTo(12, 5);
        // 起音延迟压到 0.03125s，渐入 0.05s
        const lfoGain = ctx.getLastGain();
        const fade = lfoGain.gain.rampEvents[0];
        expect(fade.value).toBeCloseTo(KARPLUS_ARTICULATION.vibratoDepth, 5);
        expect(fade.time).toBeCloseTo(0.03125 + 0.05, 5);
        ge.dispose();
    });

    it('activeNotes 与 source 生命周期对齐，停止后不再被技法误判', () => {
        vi.useFakeTimers();
        try {
            const ge = new GuitarEngine();
            ge.init();
            const noteId = ge.playNote({ frequency: 220, duration: 0.1, string: 4 });
            expect(ge.isNoteActive(noteId)).toBe(true);
            expect(ge.getNoteFrequency(noteId)).toBe(220);

            // 发声 0.3s + 50ms 断开余量后清理
            vi.advanceTimersByTime(400);
            expect(ge.isNoteActive(noteId)).toBe(false);
            expect(ge.getNoteFrequency(noteId)).toBeNull();
            ge.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it('isNoteActive 在 source.stop 后立即失效，不等节点清理定时器', () => {
        vi.useFakeTimers();
        try {
            const ge = new GuitarEngine();
            ge.init();
            const noteId = ge.playNote({ frequency: 220, duration: 0.1, string: 4 });
            // 发声 0.1 + 0.2 = 0.3s；清理在 0.35s
            expect(ge.isNoteActive(noteId)).toBe(true);

            mockNow = 0.31;
            expect(ge.isNoteActive(noteId)).toBe(false);
            const internals = ge as unknown as { activeNotes: Map<symbol, unknown> };
            expect(internals.activeNotes.has(noteId)).toBe(true); // 尚未清理
            ge.dispose();
        } finally {
            vi.useRealTimers();
        }
    });
});
