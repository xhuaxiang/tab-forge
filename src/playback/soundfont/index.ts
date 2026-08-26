/**
 * playback/soundfont — alphaTabPlayer SoundFont 播放
 *
 * alphaTabPlayer.ts      播放封装（懒加载单例：AlphaSynth + MIDI 生成 + 事件）
 * alphaTabOutput.ts      AudioWorklet 输出（ISynthOutput）
 * audioOutputWorklet.js  AudioWorkletProcessor（采样流）
 */

export { alphaTabPlayer } from './alphaTabPlayer.ts';
