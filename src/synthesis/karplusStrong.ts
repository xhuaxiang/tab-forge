/**
 * Karplus-Strong 琴弦合成算法（纯计算层）
 *
 * 物理原理：
 *   拨弦 → 噪声激励 → 延迟线(长度=采样率/频率) → 低通 → 反馈
 *
 * 每次迭代:
 *   data[n] = (data[n-L]*0.5 + data[n-L-1]*0.3 + data[n-L-2]*0.2) * decay
 *
 * 本文件只做"纯计算"：输入参数，输出裸 Float32Array 采样数据。
 * 不创建 AudioContext、无副作用，可在 Node 中单测，也便于直接导出 WAV。
 * 包装为 AudioBuffer 由 toAudioBuffer() 负责（浏览器环境）。
 */

export interface KSParams {
    frequency: number;
    duration: number;
    sampleRate: number;
    /** 弦号 (1-6)，影响衰减和音色 */
    string?: number;
    /** 闷音 */
    mute?: boolean;
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
 * 使用 Karplus-Strong 算法生成琴弦振动采样数据。
 * 不依赖 Web Audio API，返回裸 Float32Array。
 */
export function generateStringData(params: KSParams): KSBufferData {
    const { frequency, duration, sampleRate, string: stringNum, mute, sustain } = params;

    // 频率无效时返回 1 采样的静音数据（调用方也可自行短路）
    if (frequency <= 0) {
        return { data: new Float32Array(1), sampleRate, duration: 0 };
    }

    const delaySamples = Math.max(2, Math.round(sampleRate / frequency));
    const totalSamples = Math.max(delaySamples + 1, Math.round(sampleRate * (duration + 0.05)));

    const data = new Float32Array(totalSamples);

    const str = stringNum ?? 3;
    const isLow = str >= 4;
    const isHigh = str <= 2;

    // ---- 第1步：拨弦激励（短噪声） ----
    for (let i = 0; i < delaySamples; i++) {
        const noise = (Math.random() * 2 - 1);
        const att = Math.exp(-i / (delaySamples * 0.15));
        // 拾音器位置模拟：在延迟线1/8处拨弦。
        // 低音弦减弱梳状调制，避免金属"电吉他味"；高音弦保留明亮拨片感
        const pickPos = 1.0 + (isLow ? 0.12 : (isHigh ? 0.22 : 0.3)) * Math.sin(i * Math.PI * 2 / delaySamples * 0.125);
        data[i] = noise * att * pickPos;
    }

    // ---- 第2步：反馈循环（延迟线 + 低通 + 衰减） ----
    // 衰减按音符"记谱时值"缩放：到槽位结束时衰减到约 10%。
    // 短音快速收干、长音自然延音，音符之间能分得开。
    const ringDuration = Math.max(0.06, sustain ?? duration); // 至少保留 60ms 琴身主体
    const sustainFactor = isLow ? 1.15 : (isHigh ? 0.9 : 1.0); // 低音弦稍长、高音弦稍短
    const decay = mute
        ? 0.6 // 闷音：极快衰减（≈1ms）
        : Math.pow(0.03, 1 / (sampleRate * ringDuration * sustainFactor));

    if (mute) {
        // 闷音：快速衰减 + 两级平均
        for (let i = delaySamples; i < totalSamples; i++) {
            const prev = data[i - delaySamples];
            const avg = (prev + (i - delaySamples - 1 >= 0 ? data[i - delaySamples - 1] : prev)) * 0.5;
            data[i] = avg * decay;
        }
    } else {
        // 正常琴弦：不同弦用不同低通量——低音弦多低通（更暖更原声），高音弦少低通（更亮）。
        const [w1, w2, w3] = isLow
            ? [0.55, 0.25, 0.2]   // 低音：三点低通，圆润原声
            : isHigh
                ? [0.7, 0.2, 0.1] // 高音：稍加低通，亮而不尖
                : [0.7, 0.3, 0];  // 中音：适中
        for (let i = delaySamples; i < totalSamples; i++) {
            const s1 = data[i - delaySamples];
            const s2 = (i - delaySamples - 1 >= 0) ? data[i - delaySamples - 1] : s1;
            const s3 = (i - delaySamples - 2 >= 0) ? data[i - delaySamples - 2] : s1;
            const avg = (s1 * w1 + s2 * w2 + s3 * w3) * decay;
            // 轻微随机调制（±0.5%）模拟泛音微颤，噪声小、音色干净
            data[i] = avg * (1 + 0.005 * (Math.random() * 2 - 1));
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
        // 低音弦低通保持较低（~3500）不发"电味"；高音弦 6000 避免过于尖锐
        lowpassFreq: isLow ? 3500 : (isHigh ? 6000 : 6500),
        resonanceFreq: isLow ? 200 : 800,
        resonanceGain: 3.0,
    };
}
