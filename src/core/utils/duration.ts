/**
 * duration — 时值换算与命名工具（纯函数，无 DOM / 无 store）
 */

import type { NoteDuration } from '../types/note/index.ts';

/**
 * 时值 → 拍数（以四分音符为 1 拍）。
 *
 * 时值以全音符为 1，故拍数为 `d * 4`。**不做白名单兜底**：清单外时值按
 * 比例换算（为将来的三连音等留口），绝不能回落到 1 拍——那样会把 1/3
 * 时值静默当成四分音符，整条调度的时间轴都错位。
 * 这是时值→拍数的唯一实现，别在播放/渲染层再内联一份换算表。
 *
 * 非有限输入原样传播（NaN → NaN，±Infinity → ±Infinity），不做兜底；
 * 调用方若可能拿到脏数据（如未经校验的存档），需自行先校验。
 */
export function durationToBeats(d: number): number {
    return d * 4;
}

/** 时值对应的中文名称（状态栏 / 提示文案用） */
export function durationName(d: number): string {
    // Record<NoteDuration, ...> 让新增合法时值时 TS 直接报缺项；
    // 运行时对清单外的值仍然落到 `${d}拍` 兜底（故按 number 索引需断言）。
    const m: Record<NoteDuration, string> = {
        1: '全音符',
        0.5: '二分音符',
        0.25: '四分音符',
        0.125: '八分音符',
        0.0625: '十六分',
        0.03125: '三十二分',
    };
    return m[d as NoteDuration] || `${d}拍`;
}
