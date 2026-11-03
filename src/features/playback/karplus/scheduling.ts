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
import { resolvePlayDuration } from '../../../core/utils/playbackDuration.ts';
import { canSourceTechnique, isConnectingTarget } from '../../../core/utils/technique.ts';
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

/** 一段全曲静默（休止 / 空小节 / 内容不足补齐）的绝对时间范围（毫秒） */
export interface SilenceSpan {
    startMs: number;
    endMs: number;
}

export interface PlaybackSchedule {
    events: ScheduledEvent[];
    /** 整曲预计时长（毫秒） */
    totalDurationMs: number;
    /** 休止、空小节与内容不足补齐造成的静默区间，技法延音不能跨过 */
    silenceSpansMs: SilenceSpan[];
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
 * buildSchedule 的扫弦/琶音偏移在极端速度下可能越过下一个 slot，
 * 不能假定 events 已严格按时间排序。
 */
function orderByDelay(events: ScheduledEvent[]): number[] {
    return events
        .map((_, index) => index)
        .sort((a, b) => (events[a].delayMs - events[b].delayMs) || (a - b));
}

function crossesSilence(
    silenceSpansMs: readonly SilenceSpan[],
    fromMs: number,
    toMs: number,
): boolean {
    return silenceSpansMs.some(span => span.startMs < toMs && span.endMs > fromMs);
}

/**
 * 计算每个事件作为「源音」需要**额外**保持发声的时长（秒，相对该事件起点）。
 *
 * 击/勾/滑目标音复用源音的缓冲区，不重新拨弦；源音若按自己的时值提前
 * 结束，目标音就只剩缓冲末尾的一点残余。这里向后扫描同弦事件，遇到连续
 * 技法链就继续延伸，直到遇到下一个重新拨弦的音。
 *
 * 静默区间（休止/空小节/补齐段）会打断连接：缓冲区跨过整段静默后已经
 * 衰减殆尽，目标音几乎无声，不如让播放层回落到重新拨弦。palmMute/制音/
 * 断音源音由 {@link canSourceTechnique} 直接排除，ring 恒为 0。
 *
 * 返回 0 表示无需额外延长；调用方再与自身实际发声时长取 max。
 */
export function computeTechniqueRing(
    events: ScheduledEvent[],
    silenceSpansMs: readonly SilenceSpan[],
): number[] {
    const ring = events.map(() => 0);
    const order = orderByDelay(events);

    for (let oi = 0; oi < order.length; oi++) {
        const i = order[oi];
        const source = events[i];
        // 缺 string 的事件在播放层不会发声，也不能参与任何弦的技法链
        if (source.note.string == null || !canSourceTechnique(source.note)) continue;
        const stringNum = source.note.string;
        for (let oj = oi + 1; oj < order.length; oj++) {
            const j = order[oj];
            if (events[j].note.string !== stringNum) continue;
            if (!isConnectingTarget(events[j].note)) break;
            // 目标音在静默之后才出现：缓冲区已衰减，连接没有意义
            if (crossesSilence(silenceSpansMs, source.delayMs, events[j].delayMs)) break;
            const startRelSec = (events[j].delayMs - source.delayMs) / 1000;
            // 目标音的奏法时值也要算进去（如 letRing 的额外延长）
            const targetEnd = startRelSec
                + resolvePlayDuration(events[j].note, events[j].duration);
            ring[i] = Math.max(ring[i], targetEnd);
        }
    }
    return ring;
}

/**
 * 标记「因静默而必须重新拨弦」的技法目标。
 *
 * ring 只决定源音预生成多长；短休止里源音缓冲区尚未结束，播放层仅靠
 * `isNoteActive` 仍会把目标连到旧缓冲上。这里把调度层的静默语义显式传给
 * 播放层，命中后跳过连接分支。
 */
export function computeForceRepluck(
    events: ScheduledEvent[],
    silenceSpansMs: readonly SilenceSpan[],
): boolean[] {
    const forced = events.map(() => false);
    const order = orderByDelay(events);
    const lastIndexByString = new Map<number, number>();

    for (const j of order) {
        const event = events[j];
        // 与 computeTechniqueRing / 播放层一致：缺 string 的事件不参与弦链
        if (event.note.string == null) continue;
        const stringNum = event.note.string;
        const previous = lastIndexByString.get(stringNum);
        if (previous !== undefined
            && isConnectingTarget(event.note)
            && crossesSilence(silenceSpansMs, events[previous].delayMs, event.delayMs)) {
            forced[j] = true;
        }
        lastIndexByString.set(stringNum, j);
    }
    return forced;
}

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
    const silenceSpansMs: SilenceSpan[] = [];
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

            // 整拍静默（休止）会打断同弦技法连接
            if (notes.every(n => n.isRest)) {
                silenceSpansMs.push({ startMs: cursorMs, endMs: cursorMs + durMs });
            }

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
        const capacityEndMs = measureStartMs + beat * measureBeats * 1000;
        if (cursorMs < capacityEndMs - 1) {
            // 内容不足时补齐的空白同样是静默：空小节也走这里（cursorMs 仍在起点）
            silenceSpansMs.push({ startMs: cursorMs, endMs: capacityEndMs });
            cursorMs = capacityEndMs;
        }
    }

    return { events, totalDurationMs: cursorMs, silenceSpansMs };
}
