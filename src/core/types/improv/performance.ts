/**
 * performance — AI 表现层扩展的数据契约（纯数据，不含 DOM/网络）。
 *
 * `PerformancePatch` 只描述「奏法与表情」的改动，不含音高/时值/分组字段：
 * 音高与节奏由本地生成器负责，AI 只能在其上叠加表现。应用器
 * `applyPerformancePatches` 会把这些字段写到对应的拍位组上，并用
 * `validateNotes` 逐条复核，非法补丁整条丢弃。
 */

import type { AppHarmonic, Note, NoteDuration } from '../note/index.ts';

/** AI 允许输出的技法白名单（`Note.technique` 的全集） */
export const PERFORMANCE_TECHNIQUES = [
    'hammerOn',
    'pullOff',
    'slide',
    'bend',
    'vibrato',
] as const satisfies readonly NonNullable<Note['technique']>[];

/**
 * 表现层补丁：按 `(measureIndex, slotIndex)` 定位一个拍位组。
 *
 * - `null` / `false` 表示清除对应字段。
 * - 和弦组（组内音符 > 1）只接受 `dynamics` 与 `arpeggio`/`strum`；
 *   单音奏法字段会被应用器整条拒绝。
 */
export interface PerformancePatch {
    /** 0-based 小节号 */
    measureIndex: number;
    /** 0-based 拍位序号（小节内重置，休止也占号） */
    slotIndex: number;
    dynamics?: Note['dynamics'] | null;
    technique?: Note['technique'] | null;
    /** 推弦幅度（全音），仅 technique='bend'；0.25 = 1/4、0.5 = 半音、1 = 全音，缺省按 1 */
    bendAmount?: 0.25 | 0.5 | 1;
    bendRelease?: boolean;
    palmMute?: boolean | null;
    deadNote?: boolean | null;
    letRing?: boolean | null;
    staccato?: boolean | null;
    harmonic?: AppHarmonic | null;
    /** 人工/捏弦泛音的触弦点（品位差）；natural 会被清掉 */
    harmonicFret?: number;
    arpeggio?: 'up' | 'down' | null;
    strum?: 'up' | 'down' | null;
}

/** 拍位索引：序列化（给 AI 看）与补丁应用共用同一份定位规则 */
export interface PerformanceSlot {
    /** 0-based 小节号 */
    measureIndex: number;
    /** 0-based 拍位序号（小节内重置，休止也占号） */
    slotIndex: number;
    /** 拍平 notes 中的起始下标（含） */
    noteStart: number;
    /** 拍平 notes 中的结束下标（不含） */
    noteEnd: number;
    /** 小节内拍偏移（全音符 = 1） */
    start: number;
    duration: NoteDuration;
    isRest: boolean;
}
