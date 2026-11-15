/**
 * karplusStrong 单元测试
 *
 * 算法层是纯函数（输出 Float32Array），因此可直接在 Node 中验证：
 * 输出契约、能量衰减、闷音、滤波器参数、AudioBuffer 包装。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateStringData, toAudioBuffer, getBodyFilterPreset } from '../../../../features/playback/karplus/karplusStrong.ts';

// BaseAudioContext 为 DOM 全局类型，测试中只用一个最小伪造对象验证包装逻辑

const SR = 44100;

/**
 * 固定种子的线性同余 PRNG。
 *
 * Karplus-Strong 的激励与微颤使用 Math.random，不固定种子时
 * 能量比会在阈值附近浮动（实测 0.19–0.62），导致偶发失败。
 */
function seededRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

describe('generateStringData', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockImplementation(seededRandom(3));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('返回带 sampleRate 的 Float32Array 数据', () => {
        const ks = generateStringData({ frequency: 110, duration: 0.5, sampleRate: SR, string: 6 });
        expect(ks.data).toBeInstanceOf(Float32Array);
        expect(ks.sampleRate).toBe(SR);
    });

    it('输出长度等于请求时值（缓冲区末尾与 source.stop 对齐，结尾淡出会被播放）', () => {
        const duration = 0.5;
        const ks = generateStringData({ frequency: 440, duration, sampleRate: SR, string: 1 });
        expect(ks.data.length).toBe(Math.round(SR * duration));
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

    it('手掌闷音比正常音衰减更快，但不像制音那样只剩瞬态', () => {
        const normal = generateStringData({ frequency: 220, duration: 1, sampleRate: SR, string: 4 });
        const palm = generateStringData({ frequency: 220, duration: 1, sampleRate: SR, string: 4, palmMute: true });
        const rms = (d: Float32Array, from: number, to: number) => {
            let sum = 0;
            let n = 0;
            for (let i = from; i < to; i++) { sum += d[i] * d[i]; n++; }
            return Math.sqrt(sum / n);
        };
        const idx = Math.round(SR * 0.1);
        expect(rms(palm.data, idx, idx + SR * 0.02)).toBeLessThan(
            rms(normal.data, idx, idx + SR * 0.02),
        );
        // 制音在第一瞬间就掉到接近 0；手掌闷音应保留可听的琴弦能量
        expect(rms(palm.data, 0, Math.round(SR * 0.02))).toBeGreaterThan(0.01);
    });
});

function rmsRange(data: Float32Array, from: number, to: number): number {
    let sum = 0;
    let n = 0;
    for (let i = from; i < to; i++) { sum += data[i] * data[i]; n++; }
    return Math.sqrt(sum / Math.max(1, n));
}

describe('衰减包络、去直流与结尾淡出', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockImplementation(seededRandom(3));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('短 sustain 比长 sustain 更早收干', () => {
        const base = { frequency: 330, duration: 1, sampleRate: SR, string: 3 };
        const long = generateStringData({ ...base, sustain: 1 });
        // 固定噪声种子，保证两条曲线起音一致，只比较衰减
        vi.spyOn(Math, 'random').mockImplementation(seededRandom(3));
        const short = generateStringData({ ...base, sustain: 0.2 });

        const from = Math.round(SR * 0.3);
        const to = Math.round(SR * 0.4);
        expect(rmsRange(short.data, from, to)).toBeLessThan(
            rmsRange(long.data, from, to) * 0.5,
        );
    });

    it('长音整体能量在 sustain 末尾明显下降，而不是几乎不收', () => {
        const ks = generateStringData({
            frequency: 220, duration: 1, sampleRate: SR, string: 4, sustain: 1,
        });
        const head = rmsRange(ks.data, 0, Math.round(SR * 0.1));
        const tail = rmsRange(ks.data, Math.round(SR * 0.9), SR);
        const ratio = tail / head;
        // RMS 含快速衰减的泛音，会比基频的 -6dB 目标更低
        expect(ratio).toBeGreaterThan(0.05); // 仍有可听延音
        expect(ratio).toBeLessThan(0.35);    // 但明显低于起音
    });

    it('输出无明显直流偏移', () => {
        const ks = generateStringData({
            frequency: 110, duration: 1, sampleRate: SR, string: 6,
        });
        let sum = 0;
        for (const v of ks.data) sum += v;
        const mean = sum / ks.data.length;
        const rms = rmsRange(ks.data, 0, ks.data.length);
        expect(Math.abs(mean)).toBeLessThan(rms * 0.02);
    });

    it('缓冲区最后一个采样淡出到 0，避免硬切咔哒', () => {
        const ks = generateStringData({ frequency: 440, duration: 0.3, sampleRate: SR, string: 1 });
        expect(Math.abs(ks.data[ks.data.length - 1])).toBeLessThan(1e-6);
    });
});

/**
 * YIN 基频估计（累积均值归一化差分）。
 *
 * 旧的自相关峰值法在泛音较强的音上会选中 2 倍周期（880Hz 实测被读成 440Hz），
 * 而 YIN 取第一个低于阈值的谷，能稳定落在真实周期上。
 * 抛物线插值把滞后分辨率压到 0.05 采样以内。
 */
function estimateFrequency(data: Float32Array, sampleRate: number): number {
    const start = Math.floor(sampleRate * 0.05);
    const win = Math.floor(sampleRate * 0.1);
    const minLag = Math.floor(sampleRate / 1600);
    const maxLag = Math.ceil(sampleRate / 70);
    const diff = (lag: number): number => {
        let sum = 0;
        for (let i = start; i < start + win; i++) {
            const d = data[i] - data[i + lag];
            sum += d * d;
        }
        return sum;
    };
    const cmnd = new Float64Array(maxLag + 2);
    cmnd[0] = 1;
    let running = 0;
    for (let lag = 1; lag <= maxLag + 1; lag++) {
        running += diff(lag);
        cmnd[lag] = running === 0 ? 1 : (diff(lag) * lag) / running;
    }
    let bestLag = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
        if (cmnd[lag] < 0.15) {
            while (lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag]) lag++;
            bestLag = lag;
            break;
        }
    }
    if (bestLag < 0) {
        let best = Infinity;
        for (let lag = minLag; lag <= maxLag; lag++) {
            if (cmnd[lag] < best) { best = cmnd[lag]; bestLag = lag; }
        }
    }
    const y0 = cmnd[bestLag - 1];
    const y1 = cmnd[bestLag];
    const y2 = cmnd[bestLag + 1];
    const denom = y0 - 2 * y1 + y2;
    const delta = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
    return sampleRate / (bestLag + delta);
}

/** Goertzel：测单个频率在窗口内的幅值（基频包络回归用） */
function goertzel(data: Float32Array, sampleRate: number, freq: number, from: number, to: number): number {
    const w = 2 * Math.PI * freq / sampleRate;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = from; i < to; i++) {
        const s0 = data[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
}

describe('音准（分数延迟 + 滤波群延迟补偿）', () => {
    // YIN 偶尔会锁到二次谐波（实测约 1/600），固定噪声种子让音高回归稳定
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockImplementation(seededRandom(3));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('各弦基频误差 < 0.5%', () => {
        const SR48 = 48000;
        const cases: Array<[number, number]> = [
            [82.41, 6],   // 空弦 E2
            [440, 3],     // A4
            [587.33, 2],  // D5（旧实现偏低 0.8%）
            [880, 1],     // A5（旧实现偏低 1.5%）
            [1046.5, 1],  // C6
            [1318.5, 6],  // E6 低弦高把位
        ];
        for (const [freq, stringNum] of cases) {
            const ks = generateStringData({
                frequency: freq,
                duration: 0.6,
                sampleRate: SR48,
                string: stringNum,
            });
            const measured = estimateFrequency(ks.data, SR48);
            expect(Math.abs(measured - freq) / freq).toBeLessThan(0.002);
        }
    });

    it('力度与把位不改变音高（反馈权重变了，群延迟补偿要跟着变）', () => {
        const SR48 = 48000;
        const cases: Array<[number, number, 'soft' | 'accent', number]> = [
            [82.41, 6, 'accent', 12],
            [440, 3, 'soft', 5],
            [880, 1, 'accent', 12],
        ];
        for (const [freq, stringNum, dynamics, fret] of cases) {
            const ks = generateStringData({
                frequency: freq,
                duration: 0.6,
                sampleRate: SR48,
                string: stringNum,
                dynamics,
                fret,
            });
            const measured = estimateFrequency(ks.data, SR48);
            // 收紧到 0.1%：忽略 dynamicsDamping 的错误群延迟在 440Hz 就会偏 0.107%
            expect(Math.abs(measured - freq) / freq).toBeLessThan(0.001);
        }
    });

    it('高音区基频在 sustain 末尾仍接近目标，不被滤波与插值损失拖到 -60dB', () => {
        const SR48 = 48000;
        // 880Hz 单例用紧下界守住 normalDecayTarget 的标定（回退到 0.3 时约
        // -12.6dB，会被拦下）；高音区叠加滤波损失本就更低，只保留宽松下界防“早死”。
        const cases: Array<[frequency: number, string: number, minDb: number]> = [
            [880, 1, -11],
            [1046.5, 1, -20],
            [1318.5, 1, -20],
            [1318.5, 6, -20],
        ];
        for (const [freq, stringNum, minDb] of cases) {
            const sustain = 1;
            const ks = generateStringData({
                frequency: freq,
                duration: sustain + 0.2,
                sampleRate: SR48,
                string: stringNum,
                sustain,
            });
            const win = Math.round(SR48 * 0.05);
            const head = goertzel(ks.data, SR48, freq, 0, win);
            const end = Math.round(SR48 * sustain);
            const tail = goertzel(ks.data, SR48, freq, end - win, end);
            const db = 20 * Math.log10(tail / head);
            // 目标 -6dB（normalDecayTarget=0.5）：允许音区偏差，但不能早死
            expect(db).toBeGreaterThan(minDb);
            expect(db).toBeLessThan(-5);
        }
    });
});

/** 高频占比：一阶差分 RMS / 信号 RMS，越大越亮 */
function brightness(data: Float32Array, from: number, to: number): number {
    let diff = 0;
    let sig = 0;
    for (let i = from + 1; i < to; i++) {
        const d = data[i] - data[i - 1];
        diff += d * d;
        sig += data[i] * data[i];
    }
    return Math.sqrt(diff / Math.max(1, sig));
}

/** 第 h 次谐波相对基频的幅度（起音段，主要反映激励的梳状滤波） */
function harmonicRatio(
    data: Float32Array,
    sampleRate: number,
    fundamental: number,
    harmonic: number,
    from: number,
    to: number,
): number {
    return goertzel(data, sampleRate, fundamental * harmonic, from, to) /
        goertzel(data, sampleRate, fundamental, from, to);
}

describe('力度响应', () => {
    const SR48 = 48000;
    const BASE = {
        frequency: 330,
        duration: 1.2,
        sampleRate: SR48,
        string: 3,
        sustain: 1,
    };

    beforeEach(() => {
        vi.spyOn(Math, 'random').mockImplementation(seededRandom(3));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** 每个力度都从同一噪声种子起算，只比较力度本身的影响 */
    function byDynamics(dynamics?: 'soft' | 'accent'): Float32Array {
        vi.spyOn(Math, 'random').mockImplementation(seededRandom(3));
        return generateStringData({ ...BASE, dynamics }).data;
    }

    it('soft / normal / accent 的整体亮度与起音高频依次增强', () => {
        const soft = byDynamics('soft');
        const normal = byDynamics();
        const accent = byDynamics('accent');

        const tone = (d: Float32Array) => brightness(d, Math.round(SR48 * 0.02), Math.round(SR48 * 0.12));
        expect(tone(soft)).toBeLessThan(tone(normal) * 0.95);
        expect(tone(accent)).toBeGreaterThan(tone(normal) * 1.1);

        // 起音 10ms 内的瞬态：重拨的拨片声更突出
        const attack = (d: Float32Array) => brightness(d, 1, Math.round(SR48 * 0.01));
        expect(attack(soft)).toBeLessThan(attack(normal) * 0.95);
        expect(attack(accent)).toBeGreaterThan(attack(normal) * 1.1);
    });

    it('soft 收得更快、accent 延音更长（基频包络）', () => {
        // 取 0.9s 附近：衰减目标改成 -6dB 后，0.7s 时三个力度还挨得太近
        const decayRatio = (d: Float32Array) =>
            goertzel(d, SR48, 330, Math.round(SR48 * 0.9), Math.round(SR48 * 0.95)) /
            goertzel(d, SR48, 330, Math.round(SR48 * 0.1), Math.round(SR48 * 0.15));

        const soft = decayRatio(byDynamics('soft'));
        const normal = decayRatio(byDynamics());
        const accent = decayRatio(byDynamics('accent'));

        expect(soft).toBeLessThan(normal * 0.96);
        expect(accent).toBeGreaterThan(normal * 1.03);
    });
});

describe('把位与拨弦位置', () => {
    const SR48 = 48000;
    const BASE = {
        frequency: 330,
        duration: 1.2,
        sampleRate: SR48,
        string: 3,
        sustain: 1,
    };
    const FROM = Math.round(SR48 * 0.01);
    const TO = Math.round(SR48 * 0.1);

    beforeEach(() => {
        vi.spyOn(Math, 'random').mockImplementation(seededRandom(3));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function gen(extra: { fret?: number; pickPosition?: number }): Float32Array {
        vi.spyOn(Math, 'random').mockImplementation(seededRandom(3));
        return generateStringData({ ...BASE, ...extra }).data;
    }

    it('同一弦高把位的拨弦比例更大，梳状零点下移压低 4 次谐波', () => {
        const open = harmonicRatio(gen({ fret: 0 }), SR48, 330, 4, FROM, TO);
        const high = harmonicRatio(gen({ fret: 12 }), SR48, 330, 4, FROM, TO);
        expect(high).toBeLessThan(open * 0.8);
    });

    it('拨弦位置 0.3 的 3 次谐波明显低于 0.1（零点落在 3.3 次附近）', () => {
        const nearBridge = harmonicRatio(gen({ pickPosition: 0.1 }), SR48, 330, 3, FROM, TO);
        const middle = harmonicRatio(gen({ pickPosition: 0.3 }), SR48, 330, 3, FROM, TO);
        expect(middle).toBeLessThan(nearBridge * 0.5);
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
