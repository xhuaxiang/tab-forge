/**
 * 时值工具函数
 */

import type { NoteDuration } from '../types/index.ts';

/** 时值对应的符号描述 */
export function getDurationSymbol(duration: NoteDuration): { label: string; flagCount: number; fill: boolean } {
    switch (duration) {
        case 1:      return { label: '𝅝', flagCount: 0, fill: false };   // 全音符
        case 0.5:    return { label: '𝅗𝅥', flagCount: 0, fill: false };  // 二分音符
        case 0.25:   return { label: '♩', flagCount: 0, fill: true };    // 四分音符
        case 0.125:  return { label: '♪', flagCount: 1, fill: true };    // 八分音符
        case 0.0625: return { label: '♫', flagCount: 2, fill: true };    // 十六分音符
        case 0.03125:return { label: '𝅘𝅥𝅯', flagCount: 3, fill: true }; // 三十二分音符
        default:     return { label: '♩', flagCount: 0, fill: true };
    }
}

/** 休止符符号 */
export function getRestSymbol(duration: NoteDuration): string {
    switch (duration) {
        case 1:      return '𝄻';  // 全休止符
        case 0.5:    return '𝄼';  // 二分休止符
        case 0.25:   return '𝄽';  // 四分休止符
        case 0.125:  return '𝄾';  // 八分休止符
        case 0.0625: return '𝄿';  // 十六分休止符
        case 0.03125:return '𝅀';  // 三十二分休止符
        default:     return '𝄽';
    }
}

/** 时值名称（用于显示） */
export function getDurationName(duration: NoteDuration): string {
    const names: Record<number, string> = {
        1: '全音符',
        0.5: '二分音符',
        0.25: '四分音符',
        0.125: '八分音符',
        0.0625: '十六分音符',
        0.03125: '三十二分音符',
    };
    return names[duration] || '未知';
}
