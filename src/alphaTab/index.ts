/**
 * alphaTab 集成模块
 *
 * - scoreAdapter.ts  纯适配层：TabScore → alphaTab Score
 * - alphaTabPlayer.ts SoundFont 播放封装（懒加载单例）
 */

export { tabScoreToAlphaTabScore, noteNameToMidi } from './scoreAdapter.ts';
export { alphaTabPlayer } from './alphaTabPlayer.ts';
