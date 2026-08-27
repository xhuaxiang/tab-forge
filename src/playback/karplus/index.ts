/**
 * playback/karplus — Karplus-Strong 合成模块导出
 *
 * 职责分层:
 *   karplusStrong.ts — 纯算法层，生成 AudioBuffer，不连接 AudioContext
 *   guitarEngine.ts  — 引擎层，管理 AudioContext、节点连接、生命周期
 *   scheduling.ts    — 播放调度（纯函数）
 *
 * 未来可扩展:
 *   piano.ts         — 钢琴/键盘合成
 *   drum.ts          — 打击乐合成
 *   sampler.ts       — 采样播放器
 */

export { AudioEngine, currentAudioEngine } from './audioEngine.ts';
export type { PlaybackState, PlaybackCallbacks } from './audioEngine.ts';
export { generateStringData, toAudioBuffer, getBodyFilterPreset } from './karplusStrong.ts';
export type { KSParams, KSBufferData } from './karplusStrong.ts';
export { GuitarEngine } from './guitarEngine.ts';
export { buildSchedule, beatDurationSec, DURATION_TO_BEATS } from './scheduling.ts';
export type { ScheduledEvent, PlaybackSchedule } from './scheduling.ts';
