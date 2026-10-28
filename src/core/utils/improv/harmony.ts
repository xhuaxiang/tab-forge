/**
 * harmony — 和弦进行 → 每小节和弦音与可用音池（纯函数）。
 *
 * 这一层只处理 pitch class：具体八度仍由旋律音区与把位 DP 决定。
 * v1 一小节一个和弦；小节数少于进行长度时保留进行的收尾，小节数多于
 * 进行长度时循环，但最后一小节强制落在进行的最后一步，避免句子停在
 * 不稳定和弦上。
 */

import type {
    ChordDegree,
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
    CHORD_QUALITIES,
    SCALE_INTERVALS,
} from '../../types/improv.ts';
import { capacityFromTimeSignature } from '../measureUtils.ts';
import { pitchClassOf, scalePitchClasses } from './pitch.ts';

/** 和弦质量白名单（运行时输入校验用） */
export function isChordQuality(value: unknown): value is ChordQuality {
    return typeof value === 'string'
        && (CHORD_QUALITIES as readonly string[]).includes(value);
}

/** 调内级数校验 */
export function isChordDegree(value: unknown): value is ChordDegree {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= 1
        && value <= 7;
}

/** 显式和弦校验 */
export function isChordSpec(value: unknown): value is ChordSpec {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<ChordSpec>;
    return typeof candidate.rootPitchClass === 'number'
        && Number.isInteger(candidate.rootPitchClass)
        && candidate.rootPitchClass >= 0
        && candidate.rootPitchClass <= 11
        && isChordQuality(candidate.quality);
}

/** 进行步骤校验 */
export function isProgressionStep(value: unknown): value is ProgressionStep {
    return isChordDegree(value) || isChordSpec(value);
}

/**
 * 把外部输入收敛成合法进行。
 *
 * 整个数组只要有一项非法就回落到 `[1]`，不做「过滤坏项、保留好项」——
 * 半截进行比明确回落更难排查。返回值是新数组，避免调用方后续修改。
 */
export function normalizeProgression(value: unknown): Progression {
    if (!Array.isArray(value) || value.length === 0) return [1];
    if (!value.every(isProgressionStep)) return [1];
    return value.map(step => typeof step === 'number' ? step : { ...step });
}

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

/**
 * 生成每小节的和弦与音池。
 *
 * 进行展开规则：
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

    const measures: HarmonyMeasure[] = [];
    for (let measureIndex = 0; measureIndex < options.numMeasures; measureIndex++) {
        const chord = options.numMeasures <= count
            ? chords[count - options.numMeasures + measureIndex]
            : measureIndex === options.numMeasures - 1
                ? chords[count - 1]
                : chords[measureIndex % count];

        const segment: HarmonySegment = {
            start: 0,
            duration: capacity,
            chord,
            pool: buildPitchPool(chord, options),
        };
        measures.push({ measureIndex, segments: [segment] });
    }
    return measures;
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
