/**
 * roomImpulse — 代码生成的短混响脉冲响应（纯函数，无 DOM）
 *
 * 不依赖外部 IR 资源：用带限噪声 × 指数衰减生成一段短 room，
 * 由 `GuitarEngine` 包装成 AudioBuffer 交给 ConvolverNode。
 */

import { createRng } from './improv/random.ts';

export interface RoomImpulseOptions {
    sampleRate: number;
    /** IR 总时长（秒） */
    durationSec: number;
    /** 指数衰减强度：越大衰减越快 */
    decay: number;
    /** 随机种子；不同声道用不同种子做去相关 */
    seed?: number;
    /** 声道数，默认 2（轻微立体声，单声道折叠安全） */
    channels?: number;
    /** 起音前留白（秒），让混响只做湿声 */
    preDelaySec?: number;
    /** 噪声低通截止（Hz），避免混响过亮 */
    lowpassHz?: number;
}

/**
 * 生成混响 IR。返回每个声道的裸采样数据。
 * 同参数 + 同种子输出完全一致，便于单测。
 */
export function generateRoomImpulse(options: RoomImpulseOptions): Float32Array[] {
    const {
        sampleRate,
        durationSec,
        decay,
        seed = 0x5eed,
        channels = 2,
        preDelaySec = 0.003,
        lowpassHz = 5000,
    } = options;

    const length = Math.max(1, Math.round(sampleRate * durationSec));
    const preDelay = Math.min(length, Math.max(0, Math.round(sampleRate * preDelaySec)));
    const alpha = 1 - Math.exp((-2 * Math.PI * lowpassHz) / sampleRate);
    const result: Float32Array[] = [];

    for (let ch = 0; ch < channels; ch++) {
        const rng = createRng(seed + ch * 0x9e3779b9);
        const data = new Float32Array(length);
        let lowpassed = 0;
        const span = Math.max(1, length - preDelay);
        for (let i = preDelay; i < length; i++) {
            const noise = rng() * 2 - 1;
            lowpassed += alpha * (noise - lowpassed);
            const t = (i - preDelay) / span;
            data[i] = lowpassed * Math.pow(1 - t, decay);
        }
        result.push(data);
    }

    return result;
}
