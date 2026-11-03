/**
 * Karplus-Strong 琴弦合成算法（纯计算层）
 *
 * 物理原理：
 *   拨弦 → 低通噪声 + 拨弦位置梳状滤波 + 拨片瞬态 → 延迟线(长度=采样率/频率) → 低通 → 反馈
 *
 * 每次迭代:
 *   data[n] = (S1*w1 + S2*w2 + S3*w3) * decay
 *   S1..S3 是分数延迟位置上的三次插值采样，w1..w3 由弦号、力度与基频决定
 *
 * 本文件只做"纯计算"：输入参数，输出裸 Float32Array 采样数据。
 * 不创建 AudioContext、无副作用，可在 Node 中单测，也便于直接导出 WAV。
 * 包装为 AudioBuffer 由 toAudioBuffer() 负责（浏览器环境）。
 */

import { KARPLUS_ARTICULATION, KARPLUS_SYNTHESIS } from '../../../core/config.ts';

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
    /**
     * 衰减时值（秒），只作用于正常音：KS 衰减按此时值缩放，短音快速收干、
     * 长音自然延音。palmMute/制音走固定包络，不读本值。
     * 变速播放（推弦）会把 `duration` 预拉长，此时它必须同步乘同一倍率，
     * 否则衰减先于实时时值收干（换算见 core/utils/karplusTiming.ts）。
     */
    sustain?: number;
    /** 拨弦力度：影响激励亮度、起音瞬态、反馈阻尼与延音；未标注按 normal */
    dynamics?: 'soft' | 'accent';
    /** 把位（0 = 空弦）：影响拨弦位置比例与延音 */
    fret?: number;
    /** 拨弦位置（距琴桥的弦长比例）；不传则按弦号 + 把位派生 */
    pickPosition?: number;
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
    const {
        frequency,
        duration,
        sampleRate,
        string: stringNum,
        mute,
        palmMute,
        sustain,
        dynamics,
        fret: fretParam,
        pickPosition: pickPositionParam,
    } = params;

    // 频率无效时返回 1 采样的静音数据（调用方也可自行短路）
    if (frequency <= 0) {
        return { data: new Float32Array(1), sampleRate, duration: 0 };
    }

    const str = Math.min(6, Math.max(1, Math.round(stringNum ?? 3)));
    const dynamicsKey: 'soft' | 'normal' | 'accent' = dynamics ?? 'normal';
    const strength = KARPLUS_SYNTHESIS.dynamicsStrength[dynamicsKey];
    const fret = Math.max(0, Math.min(24, Math.round(fretParam ?? 0)));

    // 反馈低通权重：决定音色，也决定滤波器的群延迟。
    // 基础值来自每弦表；制音/手掌闷音用固定权重覆盖。
    const tableWeights = KARPLUS_SYNTHESIS.stringFeedbackWeights[str - 1];
    const baseW2 = mute ? 0.5 : palmMute ? 0.32 : tableWeights[0];
    const baseW3 = mute ? 0 : palmMute ? 0.18 : tableWeights[1];

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
    // 力度也参与阻尼：软拨更暗、重拨更亮；制音/手掌闷音的**反馈阻尼**
    // 固定由技法决定（激励仍随力度变化，重拨的闷音起音更硬）
    const dampingScale = mute || palmMute
        ? 1
        : (1 - (1 - KARPLUS_ARTICULATION.highFreqDampingFloor) * dampingBlend) *
            KARPLUS_SYNTHESIS.dynamicsDamping[dynamicsKey];
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

    // ---- 第1步：拨弦激励 ----
    // 低通白噪声决定力度亮度；真正的梳状滤波由拨弦位置产生
    // （零点在 k / pickPosition 次谐波上）。旧实现用一条慢正弦近似，
    // 周期远长于激励长度，实际只起到轻微包络作用，不是梳状滤波。
    const cutoff = Math.min(
        sampleRate * 0.45,
        KARPLUS_SYNTHESIS.excitationLowpassSoftHz *
            Math.pow(
                KARPLUS_SYNTHESIS.excitationLowpassAccentHz /
                    KARPLUS_SYNTHESIS.excitationLowpassSoftHz,
                strength,
            ) *
            KARPLUS_SYNTHESIS.stringBrightness[str - 1],
    );
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);

    // 把位越高，有效弦长越短；手位不变时拨弦点占比变大。
    const basePickPosition = KARPLUS_SYNTHESIS.stringPickPosition[str - 1];
    const derivedPickPosition = Math.min(
        KARPLUS_SYNTHESIS.maxPickPosition,
        basePickPosition * Math.pow(2, (fret * KARPLUS_SYNTHESIS.fretPickPositionFactor) / 12),
    );
    const pickPosition = Math.min(
        KARPLUS_SYNTHESIS.maxPickPosition,
        Math.max(KARPLUS_SYNTHESIS.minPickPosition, pickPositionParam ?? derivedPickPosition),
    );
    const pickDelay = Math.max(1, Math.min(delaySamples, Math.round(pickPosition * period)));

    const excitation = new Float32Array(delaySamples);
    let lowpassed = 0;
    for (let i = 0; i < delaySamples; i++) {
        const noise = Math.random() * 2 - 1;
        lowpassed += alpha * (noise - lowpassed);
        excitation[i] = lowpassed;
    }
    for (let i = 0; i < delaySamples; i++) {
        data[i] = excitation[i] - (i >= pickDelay ? excitation[i - pickDelay] : 0);
    }

    // 去掉激励的直流分量：反馈回路对 DC 的增益为 1，保留偏移会让低音持续段
    // 出现缓慢的低频漂移/咔哒。
    let excitationMean = 0;
    for (let i = 0; i < delaySamples; i++) {
        excitationMean += data[i];
    }
    excitationMean /= Math.max(1, delaySamples);
    for (let i = 0; i < delaySamples; i++) {
        data[i] -= excitationMean;
    }

    // 拨片/手指的短瞬态：一阶差分噪声（高通），越重拨越明显。
    // 高把位周期短时整个激励就是起音，截断到 delaySamples。
    const transientSamples = Math.min(
        delaySamples,
        Math.max(1, Math.round(sampleRate * KARPLUS_SYNTHESIS.transientSec)),
    );
    const transientGain =
        KARPLUS_SYNTHESIS.excitationRms * KARPLUS_SYNTHESIS.transientStrength * strength;
    let previousNoise = 0;
    for (let i = 0; i < transientSamples; i++) {
        const noise = Math.random() * 2 - 1;
        const click = noise - previousNoise;
        previousNoise = noise;
        const decayEnv = 1 - i / transientSamples;
        data[i] += click * transientGain * decayEnv;
    }

    // 起音能量归一化：力度只改变频谱与衰减，不改变整体响度（音量由调度层给）。
    let sumSquares = 0;
    for (let i = 0; i < delaySamples; i++) {
        sumSquares += data[i] * data[i];
    }
    const excitationRms = Math.sqrt(sumSquares / Math.max(1, delaySamples));
    if (excitationRms > 1e-9) {
        const norm = KARPLUS_SYNTHESIS.excitationRms / excitationRms;
        for (let i = 0; i < delaySamples; i++) {
            data[i] *= norm;
        }
    }

    // ---- 第2步：反馈循环（延迟线 + 低通 + 衰减） ----
    // 衰减在反馈循环里**每绕延迟线一圈**才乘一次，所以要先算出时值内会绕多少圈。
    // 旧公式把圈数误当成采样点数，每圈衰减几乎为 1，长音几乎不收干。
    const ringDuration = Math.max(0.06, sustain ?? duration); // 至少保留 60ms 琴身主体
    // 延音 = 弦号基础值 × 力度 × 把位。轻拨收得快、重拨稍长；
    // 把位越高有效弦长越短，能量耗散略快。
    const sustainFactor =
        KARPLUS_SYNTHESIS.stringSustainFactor[str - 1] *
        KARPLUS_SYNTHESIS.dynamicsSustain[dynamicsKey] *
        (1 - fret * KARPLUS_SYNTHESIS.fretDampingPerFret);
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
