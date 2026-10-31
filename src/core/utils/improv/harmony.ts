/**
 * harmony — 和弦进行 → 每小节和弦音与可用音池（纯函数）。
 *
 * 这一层只处理 pitch class：具体八度仍由旋律音区与把位 DP 决定。
 * 一小节可以有一个或多个和弦（`chordChart`），未覆盖的小节按 `progression`
 * 铺法兜底：小节数少于进行长度时保留收尾，多于进行长度时循环，但最后一
 * 小节强制落在进行的最后一步，避免句子停在不稳定和弦上。
 */

import type {
    ChordDegree,
    ChordEvent,
    ChordSpec,
    ChordQuality,
    HarmonyMeasure,
    HarmonySegment,
    PitchPool,
    Progression,
    ProgressionStep,
    ResolvedImprovOptions,
} from '../../types/improv.ts';
import {
    CHORD_INTERVALS,
    SCALE_INTERVALS,
} from '../../types/improv.ts';
import { capacityFromTimeSignature } from '../measureUtils.ts';
import { pitchClassOf, scalePitchClasses } from './pitch.ts';

// 校验与规范化已移到 progression.ts；这里保留 re-export，避免现有调用点漂移。
export {
    isChordDegree,
    isChordQuality,
    isChordSpec,
    isProgressionStep,
    normalizeProgression,
} from './progression.ts';

const TOLERANCE = 1e-9;

/** 和弦音 pitch classes（升序、去重） */
export function chordTonePitchClasses(chord: ChordSpec): number[] {
    const intervals = CHORD_INTERVALS[chord.quality] ?? CHORD_INTERVALS.major;
    return Array.from(new Set(
        intervals.map(interval => pitchClassOf(chord.rootPitchClass + interval)),
    )).sort((a, b) => a - b);
}

/**
 * 七声音阶的调内三和弦。
 *
 * 五声/六声音阶无法按三度叠置得到稳定三和弦，返回 null，由上层的
 * 主和弦兜底。这样不会为了「支持所有音阶」硬造一个调外和弦。
 */
export function diatonicChord(
    tonicPitchClass: number,
    scaleType: ResolvedImprovOptions['scaleType'],
    degree: ChordDegree,
): ChordSpec | null {
    const intervals = SCALE_INTERVALS[scaleType];
    if (intervals.length !== 7) return null;

    const index = degree - 1;
    const root = intervals[index];
    const third = intervals[(index + 2) % 7] + (index + 2 >= 7 ? 12 : 0);
    const fifth = intervals[(index + 4) % 7] + (index + 4 >= 7 ? 12 : 0);

    const thirdInterval = third - root;
    const fifthInterval = fifth - root;

    let quality: ChordQuality;
    if (thirdInterval === 4 && fifthInterval === 7) quality = 'major';
    else if (thirdInterval === 3 && fifthInterval === 7) quality = 'minor';
    else if (thirdInterval === 3 && fifthInterval === 6) quality = 'diminished';
    else if (thirdInterval === 4 && fifthInterval === 8) quality = 'augmented';
    else quality = thirdInterval === 3 ? 'minor' : 'major';

    return {
        rootPitchClass: pitchClassOf(tonicPitchClass + root),
        quality,
    };
}

/** 非七声音阶的主和弦兜底：按音阶里有没有小三度决定大小调 */
function tonicChord(
    tonicPitchClass: number,
    scaleType: ResolvedImprovOptions['scaleType'],
): ChordSpec {
    return {
        rootPitchClass: pitchClassOf(tonicPitchClass),
        quality: SCALE_INTERVALS[scaleType].includes(3) ? 'minor' : 'major',
    };
}

/** 进行步骤 → 和弦；级数在非七声音阶上回落到主和弦 */
function chordForStep(
    step: ProgressionStep,
    options: ResolvedImprovOptions,
): ChordSpec {
    if (typeof step === 'number') {
        return diatonicChord(options.tonicPitchClass, options.scaleType, step)
            ?? tonicChord(options.tonicPitchClass, options.scaleType);
    }
    return { ...step };
}

function makeSegment(
    start: number,
    duration: number,
    step: ProgressionStep,
    options: ResolvedImprovOptions,
): HarmonySegment {
    const chord = chordForStep(step, options);
    return {
        start,
        duration,
        chord,
        pool: buildPitchPool(chord, options),
    };
}

/** 把一小节的显式和弦事件铺成连续段；首段之前用默认和弦补齐 */
function segmentsForMeasure(
    events: readonly ChordEvent[],
    defaultChord: ChordSpec,
    capacity: number,
    options: ResolvedImprovOptions,
): HarmonySegment[] {
    const points: Array<{ start: number; chord: ProgressionStep }> = [];
    if (events[0].start > TOLERANCE) {
        points.push({ start: 0, chord: defaultChord });
    }
    for (const event of events) {
        points.push({ start: Math.min(capacity, Math.max(0, event.start)), chord: event.chord });
    }
    points.sort((a, b) => a.start - b.start);

    return points.map((point, index) => {
        const end = index + 1 < points.length ? points[index + 1].start : capacity;
        return makeSegment(
            point.start,
            Math.max(TOLERANCE, end - point.start),
            point.chord,
            options,
        );
    });
}

/**
 * 生成每小节的和弦与音池。
 *
 * `chordChart` 非空时，优先按显式事件铺段：同一小节可以有多个和弦，
 * 未被覆盖的小节仍按 `progression` 兜底。否则沿用逐小节铺法：
 * - 小节数 ≤ 进行长度：取进行的最后 N 步，保留收尾；
 * - 小节数 > 进行长度：循环进行，最后一小节强制落在最后一步。
 */
export function buildHarmonyPlan(options: ResolvedImprovOptions): HarmonyMeasure[] {
    const capacity = capacityFromTimeSignature(options.timeSignature);
    if (!Number.isFinite(capacity) || capacity <= 0) {
        throw new Error(`无效拍号: ${options.timeSignature}`);
    }

    const steps: Progression = options.progression.length > 0
        ? options.progression
        : [1];
    const chords = steps.map(step => chordForStep(step, options));
    const count = chords.length;

    const chartByMeasure = new Map<number, ChordEvent[]>();
    for (const event of options.chordChart) {
        if (!Number.isInteger(event.measure)
            || event.measure < 0 || event.measure >= options.numMeasures) {
            continue;
        }
        const list = chartByMeasure.get(event.measure) ?? [];
        list.push(event);
        chartByMeasure.set(event.measure, list);
    }
    for (const list of chartByMeasure.values()) {
        list.sort((a, b) => a.start - b.start);
    }

    const measures: HarmonyMeasure[] = [];
    for (let measureIndex = 0; measureIndex < options.numMeasures; measureIndex++) {
        const defaultChord = options.numMeasures <= count
            ? chords[count - options.numMeasures + measureIndex]
            : measureIndex === options.numMeasures - 1
                ? chords[count - 1]
                : chords[measureIndex % count];

        const events = chartByMeasure.get(measureIndex);
        const segments = events && events.length > 0
            ? segmentsForMeasure(events, defaultChord, capacity, options)
            : [{ start: 0, chord: defaultChord, duration: capacity }]
                .map(segment => ({
                    ...segment,
                    pool: buildPitchPool(segment.chord, options),
                }));
        measures.push({ measureIndex, segments });
    }
    return measures;
}

/** 小节内某偏移所属和弦段的下标；偏移正好落在边界时取后一段 */
export function segmentIndexAt(
    measure: HarmonyMeasure | undefined,
    offsetInMeasure: number,
): number {
    if (!measure || measure.segments.length === 0) return -1;
    for (let index = measure.segments.length - 1; index >= 0; index--) {
        if (offsetInMeasure >= measure.segments[index].start - TOLERANCE) {
            return index;
        }
    }
    return 0;
}

/** 小节内某偏移所属的和弦段 */
export function segmentAt(
    measure: HarmonyMeasure | undefined,
    offsetInMeasure: number,
): HarmonySegment | undefined {
    const index = segmentIndexAt(measure, offsetInMeasure);
    return index >= 0 ? measure?.segments[index] : undefined;
}

/** 构建一个和弦的可用音池 */
function buildPitchPool(
    chord: ChordSpec,
    options: ResolvedImprovOptions,
): PitchPool {
    const chordTones = chordTonePitchClasses(chord);
    const scaleTones = scalePitchClasses(options.tonicPitchClass, options.scaleType);
    const available = Array.from(new Set([...scaleTones, ...chordTones]))
        .sort((a, b) => a - b);
    const chordSet = new Set(chordTones);
    const passing = available.filter(pitchClass => !chordSet.has(pitchClass));
    // avoid note：位于某和弦音上方小二度的调内音（例如 C 大调里的 F）。
    // 只用于强拍/长音限制，短经过音仍可使用。
    const avoid = passing.filter(pitchClass =>
        chordTones.some(chordTone =>
            pitchClassOf(pitchClass - chordTone) === 1));

    return {
        chordPitchClasses: chordTones,
        availablePitchClasses: available,
        passingPitchClasses: passing,
        avoidPitchClasses: avoid,
    };
}
