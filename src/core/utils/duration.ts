/**
 * duration — 时值命名工具（纯映射，无 DOM）
 */

/** 时值对应的中文名称（状态栏 / 提示文案用） */
export function durationName(d: number): string {
    const m: Record<number, string> = {
        1: '全音符',
        0.5: '二分音符',
        0.25: '四分音符',
        0.125: '八分音符',
        0.0625: '十六分',
        0.03125: '三十二分',
    };
    return m[d] || `${d}拍`;
}
