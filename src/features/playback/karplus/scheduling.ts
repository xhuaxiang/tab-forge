/**
 * scheduling — 播放调度（纯函数层）
 *
 * 把 TabScore 的 measures + bpm 翻译成按时间排序的播放事件队列。
 * 不创建 AudioContext、无副作用，可独立单测。
 *
 * 输出的事件按 delayMs（相对"播放开始"的毫秒偏移）排列，
 * 实际发声由 audioEngine 负责（将事件喂给 GuitarEngine）。
 *
 * 该模块集中了最容易出错的调度规则：
 *   时值→秒换算、和弦音量补偿、扫弦/琶音的弦序与间隔、
 *   休止符与延音跳过、小节内容不足时按自身拍号容量补齐。
 */

import type { Measure, Note } from '../../../core/types/index.ts';
import { forEachSlot, measureCapacity } from '../../../core/utils/measureUtils.ts';
import { resolveNoteDynamics } from '../../../core/utils/metricAccent.ts';
import { STRUM_INTERVAL_MS, ARPEGGIO_INTERVAL_MS, DYNAMICS_VOLUME_FACTOR } from '../../../core/config.ts';

/** 单条播放事件 */
export interface ScheduledEvent {
    note: Note;
    /** 相对播放开始的毫秒偏移 */
    delayMs: number;
    /** 记谱时值对应的秒数（技法释放时间、音符时长用） */
    duration: number;
    volume: number;
    /** 生效力度（显式优先，否则拍位派生）；volume 已含对应系数，消费方不要再乘一次 */
    dynamics: Note['dynamics'];
}

export interface PlaybackSchedule {
    events: ScheduledEvent[];
    /** 整曲预计时长（毫秒） */
    totalDurationMs: number;
}

/** 一拍（四分音符）的秒数 */
export function beatDurationSec(bpm: number): number {
    return 60 / bpm;
}

/** 时值 → 拍数 */
export const DURATION_TO_BEATS: Record<number, number> = {
    1: 4,         // 全音符
    0.5: 2,       // 二分音符
    0.25: 1,      // 四分音符
    0.125: 0.5,   // 八分音符
    0.0625: 0.25, // 十六分音符
    0.03125: 0.125, // 三十二分音符
};

/**
 * 构建完整播放队列（按时间顺序）。
 *
 * @param measures      小节列表
 * @param bpm           速度
 * @param startDelayMs  首个事件相对播放开始的延迟（默认 100ms，避免冷启动爆音）
 */
export function buildSchedule(
    measures: Measure[],
    bpm: number,
    startDelayMs: number = 100,
): PlaybackSchedule {
    const beat = beatDurationSec(bpm);
    const events: ScheduledEvent[] = [];
    let cursorMs = startDelayMs;

    for (const measure of measures) {
        const signature = `${measure.timeSignatureNumerator}/${measure.timeSignatureDenominator}`;
        const measureStartMs = cursorMs;
        // 拍位偏移（全音符 = 1），用于按拍位派生重音；休止符也照常推进
        let slotOffset = 0;

        forEachSlot(measure, (notes) => {
            const first = notes[0];
            const slotStart = slotOffset;
            slotOffset += first.duration;

            const durSec = beat * (DURATION_TO_BEATS[first.duration] ?? 1);
            const durMs = durSec * 1000;

            // 和弦音量补偿：多个音符同时播放时适当降低避免削波
            // 单音=0.5, 双音=0.4, 三音=0.33, 四音=0.29, 五音=0.25, 六音=0.22
            const chordVolume = 0.5 / (1 + (notes.length - 1) * 0.25);
            // 该拍位组的派生力度：显式标注优先，否则按拍位（强拍 → accent）
            const slotDynamics = resolveNoteDynamics(first.dynamics, slotStart, first.duration, signature);
            // 力度：每个音各按自己的 dynamics 缩放（重音抬、轻音压）——律动感就靠这个对比
            const dynamicsOf = (n: Note): Note['dynamics'] => n.dynamics ?? slotDynamics;
            const volumeOf = (n: Note): number => {
                const d = dynamicsOf(n);
                return chordVolume * (d ? DYNAMICS_VOLUME_FACTOR[d] : 1);
            };

            const arpeggio = notes.length > 1 ? notes[0].arpeggio : undefined;
            const strum = notes.length > 1 ? notes[0].strum : undefined;

            if (strum) {
                // 扫弦：极短时间内依次拨弦
                // down=从6弦到1弦（低→高），up=从1弦到6弦（高→低）
                const sorted = [...notes].sort((a, b) => {
                    const sa = a.string ?? 6;
                    const sb = b.string ?? 6;
                    return strum === 'down' ? sb - sa : sa - sb;
                });
                for (let i = 0; i < sorted.length; i++) {
                    const note = sorted[i];
                    if (note.isRest) continue;
                    events.push({
                        note,
                        delayMs: cursorMs + i * STRUM_INTERVAL_MS,
                        duration: durSec,
                        volume: volumeOf(note),
                        dynamics: dynamicsOf(note),
                    });
                }
            } else if (arpeggio) {
                // 琶音：依次拨弦，每根弦间隔固定
                const sorted = [...notes].sort((a, b) => {
                    const sa = a.string ?? 6;
                    const sb = b.string ?? 6;
                    return arpeggio === 'up' ? sb - sa : sa - sb;
                });
                for (let i = 0; i < sorted.length; i++) {
                    const note = sorted[i];
                    if (note.isRest) continue;
                    events.push({
                        note,
                        delayMs: cursorMs + i * ARPEGGIO_INTERVAL_MS,
                        duration: durSec,
                        volume: volumeOf(note),
                        dynamics: dynamicsOf(note),
                    });
                }
            } else {
                // 普通和弦或单音：同时播放
                for (const note of notes) {
                    if (note.isRest || (note.tieToNext && !note.technique)) continue;
                    events.push({
                        note,
                        delayMs: cursorMs,
                        duration: durSec,
                        volume: volumeOf(note),
                        dynamics: dynamicsOf(note),
                    });
                }
            }

            cursorMs += durMs;
        });

        // 小节内容不足自身容量时补齐（部分填充的小节也会补齐）。
        // 容量以全音符为 1，换算成四分音符拍数要 ×4；不能用固定 4/4，
        // 否则 3/4、6/8 的谱子会多出拍子。
        // 非法/零容量拍号回退旧的 4 拍，避免 NaN/Infinity 毒化总时长。
        const capacity = measureCapacity(measure);
        const measureBeats = Number.isFinite(capacity) && capacity > 0 ? capacity * 4 : 4;
        if (cursorMs - measureStartMs < beat * measureBeats * 1000 - 1) {
            cursorMs = measureStartMs + beat * measureBeats * 1000;
        }
    }

    return { events, totalDurationMs: cursorMs };
}
