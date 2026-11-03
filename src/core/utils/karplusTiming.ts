import { KARPLUS_ARTICULATION } from '../config.ts';

/** Karplus 缓冲的时长拆解（秒） */
export interface KarplusBufferTiming {
    /** 实时发声时长：音符按此停止，不随变速倍率变化 */
    soundDur: number;
    /** 生成的缓冲区内容时长：按变速倍率预拉长 */
    bufferDur: number;
    /**
     * 传给 KS 的衰减时值：按同一倍率缩放的**记谱时值**（不含下限与尾音），
     * 使变速播放时衰减目标点仍落在实时的 duration。
     */
    sustain: number;
}

/**
 * 计算 Karplus 缓冲时长。
 *
 * 推弦等技法把 playbackRate 抬到目标音高的倍率，缓冲区会按倍率**提前**
 * 放完：不处理的话音高上弯的同时时值变短、衰减也更快。这里把内容
 * （长度 + 衰减时点）按同一倍率拉长，实时发声长度与停止时刻仍按
 * `max(duration, minSoundSec) + noteTailSec` 走。
 *
 * 倍率小于 1 会被夹到 1（缓冲区只预拉长、不缩短）；非有限值回落到 1，
 * 超过 {@link KARPLUS_ARTICULATION.maxPlaybackRateScale} 时封顶，
 * 避免异常输入把缓冲区拉到不可控大小。**播放速率侧必须用同一上限**
 * （见 guitarEngine.bendNote）：缓冲被夹而速率没夹，缓冲会先于实时时值放完。
 *
 * 注：只有正常音的衰减跟随时值；palmMute/制音走固定包络，不读 `sustain`。
 */
export function karplusBufferTiming(
    durationSec: number,
    playbackRateScale = 1,
): KarplusBufferTiming {
    const safeDuration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
    const rateScale = Number.isFinite(playbackRateScale)
        ? Math.min(Math.max(1, playbackRateScale), KARPLUS_ARTICULATION.maxPlaybackRateScale)
        : 1;
    const soundDur = Math.max(safeDuration, KARPLUS_ARTICULATION.minSoundSec)
        + KARPLUS_ARTICULATION.noteTailSec;
    return {
        soundDur,
        bufferDur: soundDur * rateScale,
        sustain: safeDuration * rateScale,
    };
}
