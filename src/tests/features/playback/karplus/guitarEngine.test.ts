/**
 * guitarEngine 冒烟测试
 *
 * 用 mock AudioContext 把 playNote 的完整信号链跑一遍：
 * generateStringData → toAudioBuffer → source 播放。
 * 验证重构后浏览器侧接线没有静音/抛错。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuitarEngine } from '../../../../features/playback/karplus/guitarEngine.ts';
import { KARPLUS_ARTICULATION } from '../../../../core/config.ts';

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
    delayTime = new MockParam(0);
    playbackRate = new MockParam(1);
    type = '';
    buffer: MockBuffer | null = null;
    /** 记录 source.stop 的绝对时间，验证先 ramp 再 stop */
    stoppedAt: number[] = [];

    connect() {}
    disconnect() {}
    start() {}
    stop(t?: number) { this.stoppedAt.push(t ?? 0); }
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

    createGain() { const n = new MockNode(); this.gains.push(n); return n; }
    createBufferSource() { const n = new MockNode(); this.sources.push(n); return n; }
    createBiquadFilter() { const n = new MockNode(); this.filters.push(n); return n; }
    createDelay() { return new MockNode(); }
    createOscillator() { const n = new MockNode(); this.oscillators.push(n); return n; }
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

    /** 测试辅助：gains[0]=masterGain，gains[1]=mixGain，gains[2]=envGain，gains[3]=delayGain */
    getGains(): MockNode[] { return this.gains; }

    /** 测试辅助：每个音按顺序创建 bodyFilter / resonance */
    getFilters(): MockNode[] { return this.filters; }

    /** 测试辅助：揉弦 LFO */
    getOscillators(): MockNode[] { return this.oscillators; }
}

function rms(d: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    return Math.sqrt(sum / d.length);
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

        const bodyFilter = ctx.getFilters()[0];
        // 6 弦预设 2500Hz，被 palmMuteLowpassFreq=1800 压住
        expect(bodyFilter.frequency.value).toBe(1800);
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

    it('playNote 在结束前安排 gain 淡出，再停止 source', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;

        ge.playNote({ frequency: 440, duration: 0.5, volume: 0.5, string: 1 });

        const envGain = ctx.getGains()[2];
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
        const mixGain = ctx.getGains()[1];
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
        const mixGain = ctx.getGains()[1];
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
        const mixGain = ctx.getGains()[1];
        const before = mixGain.gain.value;

        ge.dampNote(noteId, 0.1, 0.7, true);

        // 第一次 setValueAtTime 是音量系数后的电平，之后 ramp 到 0.001 收尾
        expect(mixGain.gain.scheduled[0]).toBeCloseTo(before * 0.7, 5);
        expect(ctx.getFilters()[0].frequency.ramps).toContain(1800);
        ge.dispose();
    });

    it('技法增益以调度音量为基准，不再覆盖成绝对值', () => {
        const ge = new GuitarEngine();
        ge.init();
        const ctx = ge.getContext() as unknown as MockAudioContext;
        const noteId = ge.playNote({ frequency: 220, duration: 0.5, volume: 0.4, string: 4 });
        const mixGain = ctx.getGains()[1];

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
        const lfoGain = ctx.getGains().at(-1)!;
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
