/**
 * voicing — 和弦声部与多声部把位候选（纯函数）。
 *
 * 旋律层仍是单声部；本模块只在强拍、句尾和较长拍位上给旋律下方加
 * 1-2 个当前和弦段的音，并把「一组 MIDI」换算成可同时按出的把位元组。
 * 生成与定位共用 `voicingCandidatesForMidis`，避免声部层造出 DP 落不了的音。
 */

import type { Tuning } from '../../types/index.ts';
import type {
    FretPosition,
    HarmonyMeasure,
    PlayabilityRules,
    ResolvedImprovOptions,
    SkeletonSlot,
    StyleProfile,
} from '../../types/improv.ts';
import { segmentAt } from './harmony.ts';
import { midiToFretPositions, pitchClassOf } from './pitch.ts';

/** 单个拍位的候选 voicing 上限，防止 DP 状态爆炸（性能护栏，不参与音乐语义） */
const MAX_VOICING_CANDIDATES = 64;

function comparePositions(
    a: readonly FretPosition[],
    b: readonly FretPosition[],
): number {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
        if (a[i].fret !== b[i].fret) return a[i].fret - b[i].fret;
        if (a[i].string !== b[i].string) return a[i].string - b[i].string;
    }
    return a.length - b.length;
}

function isStrictlyAscending(midis: readonly number[]): boolean {
    if (midis.length === 0) return false;
    for (let i = 0; i < midis.length; i++) {
        if (!Number.isInteger(midis[i])) return false;
        if (i > 0 && midis[i] <= midis[i - 1]) return false;
    }
    return true;
}

/**
 * 一组升序 MIDI → 可同时按出的 (弦, 品) 元组。
 *
 * - 单声部保持 `midiToFretPositions` 的原顺序，供旧 DP 逐位复现；
 * - 多声部要求 MIDI 升序对应弦号降序（低音在低编号弦上，不交叉），
 *   同弦唯一，并受品位/弦号跨度约束；
 * - 顺序与数量都确定，调用方可直接用于 DP。
 */
export function voicingCandidatesForMidis(
    tuning: Tuning,
    midis: readonly number[],
    fretMin: number,
    fretMax: number,
    playability: PlayabilityRules,
): FretPosition[][] {
    if (!isStrictlyAscending(midis)) return [];
    if (midis.length > playability.maxChordVoices) return [];

    if (midis.length === 1) {
        return midiToFretPositions(tuning, midis[0], fretMin, fretMax)
            .map(position => [position]);
    }

    const lists = midis.map(midi =>
        midiToFretPositions(tuning, midi, fretMin, fretMax));
    if (lists.some(list => list.length === 0)) return [];

    const candidates: FretPosition[][] = [];
    const chosen: FretPosition[] = [];

    const collect = (index: number): void => {
        if (candidates.length >= MAX_VOICING_CANDIDATES) return;
        if (index === lists.length) {
            candidates.push([...chosen]);
            return;
        }

        for (const position of lists[index]) {
            if (chosen.length > 0 && position.string >= chosen[chosen.length - 1].string) {
                continue;
            }

            const frets = chosen.map(item => item.fret).concat(position.fret);
            const strings = chosen.map(item => item.string).concat(position.string);
            if (Math.max(...frets) - Math.min(...frets) > playability.maxChordSpanFrets) {
                continue;
            }
            if (Math.max(...strings) - Math.min(...strings) > playability.maxChordStringSpan) {
                continue;
            }

            chosen.push(position);
            collect(index + 1);
            chosen.pop();
        }
    };

    collect(0);
    return candidates.sort(comparePositions);
}

/** 某个音级在 [low, high] 内的全部 MIDI，按从高到低排列 */
function midisOfPitchClass(
    pitchClass: number,
    low: number,
    high: number,
): number[] {
    const result: number[] = [];
    for (let midi = high; midi >= low; midi--) {
        if (pitchClassOf(midi) === pitchClass) result.push(midi);
    }
    return result;
}

/**
 * 在旋律下方为给定音级各挑一个 MIDI。
 *
 * 返回升序数组；不可行返回 null。优先高音区、紧凑排列，满足最小声部
 * 间隔与总跨度约束。
 */
function chooseLowerMidis(
    melodyMidi: number,
    pitchClasses: readonly number[],
    playability: PlayabilityRules,
): number[] | null {
    const low = melodyMidi - playability.maxVoicingSpanSemitones;
    const high = melodyMidi - playability.minVoicingGapSemitones;
    if (high < low) return null;

    const options = pitchClasses.map(pc => midisOfPitchClass(pc, low, high));
    if (options.some(list => list.length === 0)) return null;

    const results: number[][] = [];
    const chosen: number[] = [];

    const collect = (index: number): void => {
        if (index === options.length) {
            const sorted = [...chosen].sort((a, b) => a - b);
            for (let i = 1; i < sorted.length; i++) {
                if (sorted[i] - sorted[i - 1] < playability.minVoicingGapSemitones) {
                    return;
                }
            }
            results.push(sorted);
            return;
        }

        for (const midi of options[index]) {
            chosen.push(midi);
            collect(index + 1);
            chosen.pop();
        }
    };
    collect(0);

    if (results.length === 0) return null;

    // 先保证最低声部尽量高（贴近旋律），再优先总音区高、排列紧凑。
    results.sort((a, b) => {
        if (a[0] !== b[0]) return b[0] - a[0];
        const sumA = a.reduce((sum, midi) => sum + midi, 0);
        const sumB = b.reduce((sum, midi) => sum + midi, 0);
        return sumB - sumA;
    });
    return results[0];
}

/**
 * 给旋律骨架的选定拍位加和弦音。
 *
 * 纯函数，不修改入参；`chordProbability: 0` 时逐位原样返回且不消耗随机数。
 * 只从当前和弦段的 chord tone 里取音，旋律始终是最高声部。
 */
export function addVoicings(
    skeleton: SkeletonSlot[],
    harmony: readonly HarmonyMeasure[],
    options: ResolvedImprovOptions,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
): SkeletonSlot[] {
    if (style.chordProbability <= 0) return skeleton.slice();

    const lastSoundingByPhrase = new Map<number, number>();
    let lastSoundingIndex = -1;
    skeleton.forEach((slot, index) => {
        if (slot.isRest) return;
        lastSoundingIndex = index;
        if (slot.phraseIndex !== undefined) {
            lastSoundingByPhrase.set(slot.phraseIndex, index);
        }
    });

    const fretMin = options.fretRange?.min ?? playability.fretMin;
    const fretMax = options.fretRange?.max ?? playability.fretMax;
    const result: SkeletonSlot[] = [];
    let currentMeasure = -1;
    let offset = 0;

    skeleton.forEach((slot, index) => {
        if (slot.measureIndex !== currentMeasure) {
            currentMeasure = slot.measureIndex;
            offset = 0;
        }
        const startsAt = offset;
        offset += slot.duration;

        if (slot.isRest || slot.midis.length !== 1) {
            result.push(slot);
            return;
        }

        const isPhraseEnd = slot.phraseIndex !== undefined
            ? lastSoundingByPhrase.get(slot.phraseIndex) === index
            : lastSoundingIndex === index;
        if (slot.role !== 'strong'
            && !isPhraseEnd
            && slot.duration < playability.minChordDuration) {
            result.push(slot);
            return;
        }

        const segment = segmentAt(harmony[slot.measureIndex], startsAt);
        if (!segment) {
            result.push(slot);
            return;
        }

        if (rng() >= style.chordProbability) {
            result.push(slot);
            return;
        }

        const melodyMidi = slot.midis[0];
        const melodyPitchClass = pitchClassOf(melodyMidi);
        const chordPitchClasses = [...new Set(segment.pool.chordPitchClasses)]
            .filter(pitchClass => pitchClass !== melodyPitchClass);
        const rootIndex = chordPitchClasses.indexOf(segment.chord.rootPitchClass);
        if (rootIndex > 0) {
            chordPitchClasses.unshift(...chordPitchClasses.splice(rootIndex, 1));
        }

        const maxAdditional = Math.min(
            chordPitchClasses.length,
            playability.maxChordVoices - 1,
        );
        if (maxAdditional < 1) {
            result.push(slot);
            return;
        }

        const desired = maxAdditional >= 2
            && style.secondVoicingProbability > 0
            && rng() < style.secondVoicingProbability ? 2 : 1;
        const attach = (count: number): SkeletonSlot | null => {
            const lower = chooseLowerMidis(
                melodyMidi,
                chordPitchClasses.slice(0, count),
                playability,
            );
            if (lower === null) return null;
            const midis = [...lower, melodyMidi];
            const candidates = voicingCandidatesForMidis(
                options.tuning, midis, fretMin, fretMax, playability,
            );
            if (candidates.length === 0) return null;
            return { ...slot, midis };
        };

        const voiced = attach(desired)
            ?? (desired > 1 ? attach(1) : null);
        result.push(voiced ?? slot);
    });

    return result;
}
