/**
 * 可演奏性参数。
 */

import type { NoteDuration } from '../note.ts';

/**
 * 可演奏性参数。
 *
 * 品位范围、单步音程与技法最短时值由生成器/校验硬性检查；
 * `maxHandSpan`、`maxStringJump` 只作为把位 DP 的高额代价（软约束），
 * 因为换把时允许暂时超出同一把位的手距。
 */
export interface PlayabilityRules {
    fretMin: number;
    fretMax: number;
    /** 同一把位内的品位跨度；超过后 DP 加重代价（不硬性禁止换把） */
    maxHandSpan: number;
    /** 允许的跨弦数；超过后 DP 加重代价（不硬性禁止大跨弦） */
    maxStringJump: number;
    /** 单步最大音程（半音），与风格取更严者；校验会强制执行 */
    maxLeapSemitones: number;
    /** 句间换把/全曲收束允许的最大音程（半音），通常为一个八度 */
    maxPhraseLeapSemitones: number;
    /** 允许推弦的最短时值 */
    minBendDuration: NoteDuration;
    /** 允许「推上去再放回」的最短时值（释放需要更多时间） */
    minBendReleaseDuration: NoteDuration;
    /** 允许揉弦的最短时值 */
    minVibratoDuration: NoteDuration;
    /** 允许手掌闷音的最短时值 */
    minPalmMuteDuration: NoteDuration;
    /** 允许手掌闷音的最粗弦范围 [最低弦号, 最高弦号]（4-6） */
    palmMuteStrings: readonly [number, number];
    /** 允许击/勾/滑的最短时值 */
    minConnectDuration: NoteDuration;
    /** 击/勾弦允许的最大品位跨度 */
    maxHammerPullFrets: number;
    /** 滑弦允许的最大品位跨度 */
    maxSlideFrets: number;
    /** 允许制音的最短时值 */
    minDeadNoteDuration: NoteDuration;
    /** 允许断音的最短时值 */
    minStaccatoDuration: NoteDuration;
    /** 允许自由延音的最短时值 */
    minLetRingDuration: NoteDuration;
    /** 允许泛音的最短时值 */
    minHarmonicDuration: NoteDuration;
    /** 允许制音的弦号范围 [最低弦号, 最高弦号] */
    deadNoteStrings: readonly [number, number];
    /** 允许捏弦泛音的弦号范围 [最低弦号, 最高弦号] */
    pinchHarmonicStrings: readonly [number, number];
    /** 自然泛音可用的绝对品位（节点就是 fret） */
    naturalHarmonicFrets: readonly number[];
    /** 人工/捏弦泛音可用的触弦点位差（相对按弦位置，不是绝对品位） */
    harmonicFrets: readonly number[];
    /** 触发和弦加厚的最短时值（强拍/句尾不受此限） */
    minChordDuration: NoteDuration;
    /** 和弦组最大声部数（含旋律） */
    maxChordVoices: number;
    /** 和弦组最高与最低声部的最大半音跨度 */
    maxVoicingSpanSemitones: number;
    /** 和弦组相邻声部的最小半音间隔 */
    minVoicingGapSemitones: number;
    /** 和弦组内最大品位跨度 */
    maxChordSpanFrets: number;
    /** 和弦组内最大弦号跨度 */
    maxChordStringSpan: number;
}
