/**
 * Karplus-Strong 琴弦合成算法（纯计算层）
 *
 * 物理原理：
 *   拨弦 → 噪声激励 → 延迟线(长度=采样率/频率) → 低通 → 反馈
 *
 * 每次迭代:
 *   data[n] = (S1*w1 + S2*w2 + S3*w3) * decay
 *   S1..S3 是分数延迟位置上的三次插值采样，w1..w3 由弦号与基频决定
 *
 * 本文件只做"纯计算"：输入参数，输出裸 Float32Array 采样数据。
 * 不创建 AudioContext、无副作用，可在 Node 中单测，也便于直接导出 WAV。
 * 包装为 AudioBuffer 由 toAudioBuffer() 负责（浏览器环境）。
 */

import { KARPLUS_ARTICULATION } from '../../../core/config.ts';

export interface KSParams {
    frequency: number;
    duration: number;
    sampleRate: number;
    /** 弦号 (1-6)，影响衰减和音色 */
    string?: number;
    /** 闷音（制音/死音） */
    mute?: boolean;
    /** 手掌闷音：比正常音更快衰减、更暗，但不至于像制音那样只剩打击感 */
    palmMute?: boolean;
    /** 记谱时值（秒）。KS 衰减按此时值缩放：短音快速收干、长音自然延音 */
    sustain?: number;
}

/** 纯计算输出：裸采样数据 + 元信息 */
export interface KSBufferData {
    data: Float32Array;
    sampleRate: number;
    /** 实际有效时长（秒） */
    duration: number;
}

/**
 * Catmull-Rom 四点插值（t 在 p1 与 p2 之间）。
 *
 * 反馈回路的分数延迟用线性插值时，插值本身在基频处有可观的幅度衰减：
 * 880Hz、分数部分 0.5 时每圈约 0.017dB，1 秒累计 12dB，高音会远早于
 * sustain 目标收干。三次插值在低频段幅度接近 1，代价是每个采样多读几个值。
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
        2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
}

/**
 * 使用 Karplus-Strong 算法生成琴弦振动采样数据。
 * 不依赖 Web Audio API，返回裸 Float32Array。
 */
export function generateStringData(params: KSParams): KSBufferData {
    const { frequency, duration, sampleRate, string: stringNum, mute, palmMute, sustain } = params;

    // 频率无效时返回 1 采样的静音数据（调用方也可自行短路）
    if (frequency <= 0) {
        return { data: new Float32Array(1), sampleRate, duration: 0 };
    }

    const str = stringNum ?? 3;
    const isLow = str >= 4;
    const isHigh = str <= 2;

    // 反馈低通权重：决定音色，也决定滤波器的群延迟
    const [baseW2, baseW3] = mute
        ? [0.5, 0]                  // 制音：两级平均，最快收干
        : palmMute
            ? [0.32, 0.18]          // 手掌闷音：更强低通，闷而短
            : isLow
                ? [0.25, 0.2]       // 低音：三点低通，圆润原声
                : isHigh
                    ? [0.2, 0.1]    // 高音：稍加低通，亮而不尖
                    : [0.3, 0];     // 中音：适中

    // 基频越高，反馈滤波在每圈里的能量损失累计越可观（880Hz 一圈损失
    // 约 0.03dB，1 秒就是 26dB），会把 sustain 的实际衰减拉得远早于目标。
    // 高音区按比例削弱滤波强度，让基频处 |H| 接近 1；琴体低通仍负责音色。
    const dampingBlend = Math.min(
        1,
        Math.max(
            0,
            (frequency - KARPLUS_ARTICULATION.highFreqDampingStartHz) /
                (KARPLUS_ARTICULATION.highFreqDampingEndHz - KARPLUS_ARTICULATION.highFreqDampingStartHz),
        ),
    );
    const dampingScale = mute || palmMute
        ? 1
        : 1 - (1 - KARPLUS_ARTICULATION.highFreqDampingFloor) * dampingBlend;
    const w2 = baseW2 * dampingScale;
    const w3 = baseW3 * dampingScale;
    const w1 = 1 - w2 - w3;

    // ---- 延迟线长度：分数延迟 + 滤波群延迟补偿 ----
    // 低通会在延迟线之外再引入约 g 个采样的群延迟。若只按
    // round(sampleRate / frequency) 取整数，实际周期 = 延迟线 + g，音高偏低；
    // 高把位周期短，取整误差能让音准偏出 20 音分以上。
    // 因此按「总延迟 = 采样率 / 频率」反推延迟线长度，小数部分用三次插值补上。
    const filterDelay = (w2 + 2 * w3) / (w1 + w2 + w3);
    const period = sampleRate / frequency;
    const totalDelay = Math.max(2, period - filterDelay);
    const delaySamples = Math.floor(totalDelay);
    const frac = totalDelay - delaySamples;

    const totalSamples = Math.max(delaySamples + 2, Math.round(sampleRate * duration));

    const data = new Float32Array(totalSamples);

    // ---- 第1步：拨弦激励（短噪声） ----
    let excitationMean = 0;
    for (let i = 0; i < delaySamples; i++) {
        const noise = (Math.random() * 2 - 1);
        const att = Math.exp(-i / (delaySamples * 0.15));
        // 拾音器位置模拟：在延迟线1/8处拨弦。
        // 低音弦减弱梳状调制，避免金属"电吉他味"；高音弦保留明亮拨片感
        const pickPos = 1.0 + (isLow ? 0.12 : (isHigh ? 0.22 : 0.3)) * Math.sin(i * Math.PI * 2 / delaySamples * 0.125);
        data[i] = noise * att * pickPos;
        excitationMean += data[i];
    }
    // 去掉激励的直流分量：反馈回路对 DC 的增益为 1，保留偏移会让低音持续段
    // 出现缓慢的低频漂移/咔哒。
    excitationMean /= Math.max(1, delaySamples);
    for (let i = 0; i < delaySamples; i++) {
        data[i] -= excitationMean;
    }

    // ---- 第2步：反馈循环（延迟线 + 低通 + 衰减） ----
    // 衰减在反馈循环里**每绕延迟线一圈**才乘一次，所以要先算出时值内会绕多少圈。
    // 旧公式把圈数误当成采样点数，每圈衰减几乎为 1，长音几乎不收干。
    const ringDuration = Math.max(0.06, sustain ?? duration); // 至少保留 60ms 琴身主体
    // 低音弦不再额外拉长延音(原 1.15),降低低音"突出感"；高音弦仍稍短
    const sustainFactor = isLow ? 1.0 : (isHigh ? 0.9 : 1.0);
    const decaySeconds = Math.max(0.001, ringDuration * sustainFactor);
    // 总延迟（延迟线 + 低通群延迟）等于 period，因此每圈时长就是 period
    const loopCount = Math.max(1, (sampleRate * decaySeconds) / period);
    const normalDecay = Math.pow(KARPLUS_ARTICULATION.normalDecayTarget, 1 / loopCount);
    // 手掌闷音同样按“palmMuteDecaySec 内衰到目标比例”换算每圈衰减
    const palmMuteLoopCount = Math.max(
        1,
        (KARPLUS_ARTICULATION.palmMuteDecaySec * sampleRate) / period,
    );
    const palmMuteDecay = Math.pow(
        KARPLUS_ARTICULATION.palmMuteDecayTarget,
        1 / palmMuteLoopCount,
    );
    const decay = mute
        ? 0.6 // 制音/死音：极快衰减（≈1ms）
        : palmMute
            ? palmMuteDecay
            : normalDecay;

    // 从 delaySamples + 1 开始：分数延迟插值需要读到 i - delaySamples - 1
    const read = (index: number): number => (index >= 0 ? data[index] : data[0]);
    for (let i = delaySamples + 1; i < totalSamples; i++) {
        const j = i - delaySamples;
        // 三个低通抽头都在分数延迟位置上取值（半径由 frac 决定）。
        // 线性插值在基频处也有每圈衰减（880Hz 约 0.03dB，1 秒 12dB），
        // 与滤波损失叠加；三次插值在低频段幅度几乎为 1，避免高音早死。
        const s1 = catmullRom(read(j + 1), read(j), read(j - 1), read(j - 2), frac);
        const s2 = catmullRom(read(j), read(j - 1), read(j - 2), read(j - 3), frac);
        const s3 = catmullRom(read(j - 1), read(j - 2), read(j - 3), read(j - 4), frac);
        // 逐采样的宽带随机调制会给整段音色铺一层嘶声；泛音的“活气”交给激励层，
        // 反馈回路保持干净。
        data[i] = (s1 * w1 + s2 * w2 + s3 * w3) * decay;
    }

    // 缓冲区结尾平滑淡出：即使 source 被安排在 buffer 末尾停止，也不会在
    // 非零采样处硬切产生咔哒。
    const fadeSamples = Math.min(
        Math.floor(sampleRate * KARPLUS_ARTICULATION.tailFadeSec),
        totalSamples,
    );
    if (fadeSamples > 1) {
        const fadeStart = totalSamples - fadeSamples;
        for (let i = fadeStart; i < totalSamples; i++) {
            // 1 → 0 的 raised-cosine，最后一个采样恰好为 0
            const t = (i - fadeStart + 1) / fadeSamples;
            data[i] *= 0.5 * (1 + Math.cos(Math.PI * t));
        }
    }

    return { data, sampleRate, duration };
}

/**
 * 将纯采样数据包装为 AudioBuffer（浏览器环境）。
 * 应用层唯一需要接触 AudioContext 的地方。
 */
export function toAudioBuffer(ctx: BaseAudioContext, ks: KSBufferData): AudioBuffer {
    const buffer = ctx.createBuffer(1, ks.data.length, ks.sampleRate);
    buffer.getChannelData(0).set(ks.data);
    return buffer;
}

/**
 * 获取琴体共鸣的滤波器参数（根据弦号）
 */
export function getBodyFilterPreset(stringNum?: number): {
    lowpassFreq: number;
    resonanceFreq: number;
    resonanceGain: number;
} {
    const str = stringNum ?? 3;
    const isLow = str >= 4;
    const isHigh = str <= 2;

    return {
        // 低音弦低通再降到 2500：更暗更沉、不抢戏；高音弦 6000 避免过于尖锐
        lowpassFreq: isLow ? 2500 : (isHigh ? 6000 : 6500),
        // 低音共振峰下移到 180Hz：低音"沉"在下面，不顶在 200Hz 处
        resonanceFreq: isLow ? 180 : 800,
        // 低音弦保持低共振增益(1.5)，不增加响度上的"突出"
        resonanceGain: isLow ? 1.5 : 3.0,
    };
}
