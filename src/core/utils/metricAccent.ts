/**
 * metricAccent — 按拍位派生播放力度（纯函数）
 *
 * 播放层用：音符未显式标 `dynamics` 时，强拍自动派生 accent。
 * 只派生播放用的力度，不写回 Note/TabScore；显式标注永远优先。
 *
 * 拍位判定完全复用 improv/rhythm.ts 的 classifySlotRole（4/4、3/4、6/8、7/8…），
 * 这里只做「角色 → Note.dynamics」的映射与优先级，不复制任何拍号规则。
 */

import type { Note, NoteDuration } from '../types/index.ts';
import { AUTO_METRIC_ACCENT, METRIC_ACCENT_DYNAMICS } from '../config.ts';
import { parseTimeSignature } from './measureUtils.ts';
import { classifySlotRole } from './improv/rhythm.ts';

/**
 * 拍位 → 派生力度。
 *
 * @param offset        拍位偏移（全音符 = 1，与 classifySlotRole 一致）
 * @param duration      该拍位组的时值
 * @param timeSignature 拍号字符串，如 `'4/4'`、`'6/8'`
 * @returns 强拍返回 `'accent'`，其余返回 undefined；非法拍号不派生
 */
export function metricDynamics(
    offset: number,
    duration: NoteDuration,
    timeSignature: string,
): Note['dynamics'] {
    const { numerator, denominator } = parseTimeSignature(timeSignature);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator)
        || numerator <= 0 || denominator <= 0) {
        return undefined;
    }
    return METRIC_ACCENT_DYNAMICS[classifySlotRole(offset, duration, timeSignature)];
}

/**
 * 解析音符的生效力度：显式值优先，未标时按拍位派生（可由开关关闭）。
 */
export function resolveNoteDynamics(
    explicit: Note['dynamics'],
    offset: number,
    duration: NoteDuration,
    timeSignature: string,
    enabled: boolean = AUTO_METRIC_ACCENT,
): Note['dynamics'] {
    if (explicit !== undefined) return explicit;
    return enabled ? metricDynamics(offset, duration, timeSignature) : undefined;
}
