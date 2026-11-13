/**
 * 播放状态（两个播放引擎共用）。
 *
 * 放在 core/types 而不是某个引擎里：它不是 Karplus 专有——SoundFont 侧走同一套
 * 回调契约，`uiStore` 也要存它；而 core 不能依赖 features，所以类型只能住在这里。
 */
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';
