/**
 * alphaTab 集成模块
 *
 * - scoreAdapter.ts  纯适配层：TabScore → alphaTab Score
 *
 * 注意：本目录不含播放实现——SoundFont 播放是 playback/soundfont/ 的事，
 * 消费方直接 import 那条路径（见 app/eventHandlers.ts 的动态 import）。
 */

export { tabScoreToAlphaTabScore, noteNameToMidi } from './scoreAdapter.ts';
export { AlphaTabRenderer } from './alphaTabRenderer.ts';
