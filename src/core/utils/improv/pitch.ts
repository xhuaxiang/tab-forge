/**
 * pitch — 调性、音阶与指板音高换算（纯函数）。
 *
 * 音名 → MIDI 复用 scoreMapping 的 noteNameToMidi，不再写第二套升降号解析；
 * 这里只补「调性 → pitch class」「MIDI ↔ (弦, 品)」这些生成器需要的换算。
 */

import type { Tuning } from '../../types/index.ts';
import type { FretPosition, ScaleType } from '../../types/improv.ts';
import { SCALE_INTERVALS } from '../../types/improv.ts';
import { noteNameToMidi } from '../scoreMapping.ts';

/** 音高 class（0-11），对负数也安全 */
export function pitchClassOf(midi: number): number {
    return ((midi % 12) + 12) % 12;
}

/**
 * 解析调性字符串（如 `C`、`Am`、`F#m`、`Bb`）为主音 pitch class。
 *
 * 后缀 `m` 只表示“小调写法”，不参与音程计算——音阶由 scaleType 决定。
 * 非法写法返回 null，由调用方回落到默认调性。
 */
export function parseKey(key: string): { key: string; tonicPitchClass: number } | null {
    const trimmed = key.trim();
    const match = trimmed.match(/^([A-Ga-g])([#b]?)(m)?$/);
    if (!match) return null;

    const letter = match[1].toUpperCase();
    const accidental = match[2] ?? '';
    const isMinor = match[3] === 'm';
    const midi = noteNameToMidi(`${letter}${accidental}4`);
    if (midi <= 0) return null;

    return {
        key: `${letter}${accidental}${isMinor ? 'm' : ''}`,
        tonicPitchClass: pitchClassOf(midi),
    };
}

/** 音阶的 pitch class 集合（升序、去重） */
export function scalePitchClasses(tonicPitchClass: number, scaleType: ScaleType): number[] {
    const classes = SCALE_INTERVALS[scaleType].map(interval =>
        pitchClassOf(tonicPitchClass + interval));
    return Array.from(new Set(classes)).sort((a, b) => a - b);
}

/** 该 MIDI 是否落在调内 */
export function isInScale(midi: number, tonicPitchClass: number, scaleType: ScaleType): boolean {
    return scalePitchClasses(tonicPitchClass, scaleType).includes(pitchClassOf(midi));
}

/**
 * 主三和弦的 pitch classes：[主音, 三音, 五音]。
 *
 * 三音从音阶里取：含大三度(4)用 4，否则含小三度(3)用 3。
 * 五音优先 7，避免把 Blue note 的 b5 当成稳定音。
 */
export function tonicTriadPitchClasses(tonicPitchClass: number, scaleType: ScaleType): number[] {
    const intervals = SCALE_INTERVALS[scaleType];
    const third = intervals.includes(4) ? 4 : intervals.includes(3) ? 3 : 4;
    return Array.from(new Set([
        pitchClassOf(tonicPitchClass),
        pitchClassOf(tonicPitchClass + third),
        pitchClassOf(tonicPitchClass + 7),
    ])).sort((a, b) => a - b);
}

/** 调弦各弦的空弦 MIDI（1 弦 → 6 弦） */
export function openStringMidis(tuning: Tuning): Record<number, number> {
    const names = [
        tuning.string1, tuning.string2, tuning.string3,
        tuning.string4, tuning.string5, tuning.string6,
    ];
    const result: Record<number, number> = {};
    names.forEach((name, index) => {
        const midi = noteNameToMidi(name);
        if (midi <= 0) throw new Error(`无效调弦音名: ${name}`);
        result[index + 1] = midi;
    });
    return result;
}

/** 某弦某品的 MIDI 音号 */
export function fretToMidi(tuning: Tuning, string: number, fret: number): number {
    const open = openStringMidis(tuning)[string];
    if (open === undefined) throw new Error(`无效弦号: ${string}`);
    return open + fret;
}

/**
 * 找出能发出该 MIDI 的所有 (弦, 品) 候选。
 *
 * 结果按品位升序、同品按弦号升序，保证 DP 的平局打破是确定性的。
 */
export function midiToFretPositions(
    tuning: Tuning,
    midi: number,
    fretMin: number,
    fretMax: number,
): FretPosition[] {
    const open = openStringMidis(tuning);
    const positions: FretPosition[] = [];
    for (let string = 1; string <= 6; string++) {
        const fret = midi - open[string];
        if (Number.isInteger(fret) && fret >= fretMin && fret <= fretMax) {
            positions.push({ string, fret, midi });
        }
    }
    return positions.sort((a, b) => a.fret - b.fret || a.string - b.string);
}

/** 指板可演奏的 MIDI 范围 [最低空弦, 最高弦最高品] */
export function playableMidiRange(tuning: Tuning, fretMax: number): readonly [number, number] {
    const open = Object.values(openStringMidis(tuning));
    return [Math.min(...open), Math.max(...open) + fretMax];
}

/** 范围内所有调内 MIDI（含端点） */
export function scaleMidisInRange(
    tonicPitchClass: number,
    scaleType: ScaleType,
    minMidi: number,
    maxMidi: number,
): number[] {
    const result: number[] = [];
    for (let midi = Math.ceil(minMidi); midi <= Math.floor(maxMidi); midi++) {
        if (isInScale(midi, tonicPitchClass, scaleType)) result.push(midi);
    }
    return result;
}

/**
 * 在给定范围内找最接近目标、且 pitch class 属于指定集合的 MIDI。
 *
 * 从目标音向外对称搜索，先低后高（低音更稳），找不到返回 null。
 */
export function nearestMidiWithPitchClasses(
    targetMidi: number,
    pitchClasses: readonly number[],
    minMidi: number,
    maxMidi: number,
): number | null {
    const wanted = new Set(pitchClasses.map(pitchClassOf));
    // 目标可能落在范围外（例如窗口收窄到 current 附近），搜索半径要覆盖
    // 目标到最近端点的距离，否则会提前返回 null。
    const maxDistance = Math.max(
        Math.abs(targetMidi - minMidi),
        Math.abs(targetMidi - maxMidi),
    );
    for (let distance = 0; distance <= maxDistance; distance++) {
        const lower = targetMidi - distance;
        const upper = targetMidi + distance;
        if (lower >= minMidi && lower <= maxMidi && wanted.has(pitchClassOf(lower))) {
            return lower;
        }
        if (distance > 0 && upper >= minMidi && upper <= maxMidi && wanted.has(pitchClassOf(upper))) {
            return upper;
        }
    }
    return null;
}
