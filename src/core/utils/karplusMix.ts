/**
 * karplusMix — Karplus 混音层的纯换算（无副作用）
 *
 * 高通分频与声像只依赖弦号，抽出来便于单测，也避免引擎里散落魔法数。
 */

import { KARPLUS_MIX } from '../config.ts';

/** 按弦号取高通截止（Hz）：低弦保留琴体低频，高弦切掉多余隆隆声 */
export function highpassHzForString(stringNum: number | undefined): number {
    if (stringNum === undefined) return KARPLUS_MIX.highpassMidStringHz;
    if (stringNum >= 5) return KARPLUS_MIX.highpassLowStringHz;
    if (stringNum <= 2) return KARPLUS_MIX.highpassHighStringHz;
    return KARPLUS_MIX.highpassMidStringHz;
}

/**
 * 轻微声像：6 弦偏左、1 弦偏右，单声道折叠时左右能量对称。
 * 偏移量远小于 1，避免单边听感明显。
 */
export function panForString(stringNum: number | undefined): number {
    if (stringNum === undefined) return 0;
    const pan = (KARPLUS_MIX.panCenterString - stringNum) * KARPLUS_MIX.panStep;
    return Math.max(-1, Math.min(1, pan));
}
