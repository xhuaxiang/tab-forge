/**
 * playback — 播放统一出口
 *
 * 分层：
 * - karplus/   Karplus-Strong 合成（audioEngine 播放编排 + guitarEngine 引擎 + karplusStrong 算法 + scheduling 调度）
 * - soundfont/ alphaTabPlayer SoundFont 播放（AlphaSynth + AudioWorklet 输出）
 */

// ---- Karplus-Strong 合成 ----
export {
    AudioEngine,
    currentAudioEngine,
    GuitarEngine,
    buildSchedule,
    beatDurationSec,
    DURATION_TO_BEATS,
    generateStringData,
    toAudioBuffer,
    getBodyFilterPreset,
} from './karplus/index.ts';
export type { PlaybackState, PlaybackCallbacks, ScheduledEvent, PlaybackSchedule, KSParams, KSBufferData } from './karplus/index.ts';

// ---- SoundFont 播放 ----
export { alphaTabPlayer, createAlphaTabWorkletOutput } from './soundfont/index.ts';
