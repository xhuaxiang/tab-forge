/**
 * melody — 在调内生成旋律骨架（纯函数）。
 *
 * 这一步只决定“弹什么音高”，不决定“在哪根弦上弹”；把位由 positioning DP 负责。
 * 骨架用音阶级数做随机游走，并用一个短动机重复/变化，避免听起来像无序音阶练习。
 */

import type {
    HarmonyMeasure,
    PlayabilityRules,
    ResolvedImprovOptions,
    RhythmMeasure,
    SkeletonSlot,
    StyleProfile,
} from '../../types/improv.ts';
import { buildHarmonyPlan } from './harmony.ts';
import { pickWeighted } from './random.ts';
import {
    nearestMidiWithPitchClasses,
    pitchClassOf,
    playableMidiRange,
    scaleMidisInRange,
    tonicTriadPitchClasses,
} from './pitch.ts';

/** 旋律中心附近的可选 MIDI */
function buildRegister(
    options: ResolvedImprovOptions,
    style: StyleProfile,
    playability: PlayabilityRules,
): {
    midis: number[];
    low: number;
    high: number;
    center: number;
    playLow: number;
    playHigh: number;
} {
    const [playMin, playMax] = playableMidiRange(options.tuning, playability.fretMax);
    const center = Math.min(playMax, Math.max(playMin, style.registerCenterMidi));
    const halfRange = Math.floor(style.registerRangeSemitones / 2);
    let low = Math.max(playMin, center - halfRange);
    let high = Math.min(playMax, center + halfRange);

    let midis = scaleMidisInRange(
        options.tonicPitchClass, options.scaleType, low, high,
    );
    if (midis.length === 0) {
        low = playMin;
        high = playMax;
        midis = scaleMidisInRange(options.tonicPitchClass, options.scaleType, low, high);
    }
    if (midis.length === 0) {
        throw new Error('调内没有可演奏的音高');
    }
    return { midis, low, high, center, playLow: playMin, playHigh: playMax };
}

/** 在 register 中找最接近 current 的下标；平局取较低音 */
function nearestIndex(register: readonly number[], current: number): number {
    let best = 0;
    let bestDistance = Math.abs(register[0] - current);
    for (let index = 1; index < register.length; index++) {
        const distance = Math.abs(register[index] - current);
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    }
    return best;
}

/** 按音阶级数走 step 步，并保证单步不超过 maxLeap */
function stepFrom(
    current: number,
    step: number,
    register: readonly number[],
    maxLeap: number,
): number {
    const currentIndex = nearestIndex(register, current);
    const direction = step === 0 ? 0 : step > 0 ? 1 : -1;
    let targetIndex = Math.max(0, Math.min(register.length - 1, currentIndex + step));

    // 级数步长在五声音阶/跨八度时可能超过 maxLeap，逐级退回
    while (targetIndex !== currentIndex
        && Math.abs(register[targetIndex] - current) > maxLeap) {
        targetIndex -= direction;
    }
    return register[targetIndex];
}

/** 随机级数步：以级进为主，偶尔三度跳进，少量同音 */
function randomStep(rng: () => number): number {
    return pickWeighted(rng, [
        { value: -2, weight: 0.15 },
        { value: -1, weight: 0.35 },
        { value: 0, weight: 0.1 },
        { value: 1, weight: 0.35 },
        { value: 2, weight: 0.15 },
    ]);
}

/** 生成长度为 length 的动机（级数步） */
function buildMotifSteps(length: number, rng: () => number): number[] {
    const steps: number[] = [];
    for (let index = 0; index < length; index++) {
        steps.push(randomStep(rng));
    }
    if (steps.reduce((sum, step) => sum + Math.abs(step), 0) === 0) steps[0] = 1;
    return steps;
}

/**
 * 把候选音吸到目标和弦音上，且不超出当前音的单步音程。
 *
 * 搜索窗口围绕 current，而不是围绕候选音，保证吸完之后仍然“弹得到”。
 */
function snapToPitchClasses(
    candidate: number,
    current: number,
    pitchClasses: readonly number[],
    low: number,
    high: number,
    maxLeap: number,
): number {
    const min = Math.max(low, current - maxLeap);
    const max = Math.min(high, current + maxLeap);
    return nearestMidiWithPitchClasses(candidate, pitchClasses, min, max) ?? candidate;
}

/**
 * 句尾落到主音。
 *
 * 第一搜索范围是「当前音 ± 风格上限」，并且限定在整条指板的可演奏范围，
 * 而不是风格音区：风格音区可能把附近的主音排除在外（例如 D 大调里
 * D3=50 在 Jazz 音区下方），于是只能跳到更远的 D4，产生超限跳进。
 * 若风格上限内确实没有主音（最近主音可能相隔 6 个半音），再放宽到
 * 可演奏性上限；这个例外只作用于全曲最后一个音。
 */
function resolveToTonic(
    current: number,
    tonicPitchClass: number,
    playLow: number,
    playHigh: number,
    maxLeap: number,
    finalMaxLeap: number,
): number {
    const nearMin = Math.max(playLow, current - maxLeap);
    const nearMax = Math.min(playHigh, current + maxLeap);
    const near = nearestMidiWithPitchClasses(
        current, [tonicPitchClass], nearMin, nearMax,
    );
    if (near !== null) return near;

    const finalMin = Math.max(playLow, current - finalMaxLeap);
    const finalMax = Math.min(playHigh, current + finalMaxLeap);
    return nearestMidiWithPitchClasses(
        current, [tonicPitchClass], finalMin, finalMax,
    ) ?? current;
}

/**
 * 生成旋律骨架。
 *
 * 约束：
 * - 所有发音在调内，或属于当前小节和弦音；
 * - 强拍、每小节第一个音与最后一个音落在当前小节和弦音；
 * - 非经过音（时值 > 1/8）避开 avoid note；短经过音仍可使用；
 * - 全曲最后一个音落在主音；
 * - 相邻音不超过 min(style.maxLeap, playability.maxLeap)。
 *
 * @param harmony 可选的每小节和声计划；不传时按 `options.progression` 生成。
 */
export function buildSkeleton(
    plan: RhythmMeasure[],
    options: ResolvedImprovOptions,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
    harmony?: readonly HarmonyMeasure[],
): SkeletonSlot[] {
    const register = buildRegister(options, style, playability);
    const harmonyPlan = harmony ?? buildHarmonyPlan(options);
    const fallbackTriad = tonicTriadPitchClasses(
        options.tonicPitchClass, options.scaleType,
    );
    const maxLeap = Math.max(1, Math.min(style.maxLeapSemitones, playability.maxLeapSemitones));
    // 最近主音最多可能相隔 6 个半音；最终音允许放宽到可演奏性上限。
    const finalMaxLeap = Math.min(
        playability.maxLeapSemitones,
        Math.max(maxLeap, 6),
    );
    const motifLength = Math.max(1, Math.round(style.motifLength));
    const motifSteps = buildMotifSteps(motifLength, rng);

    const result: SkeletonSlot[] = [];
    let previousMidi: number | null = null;

    for (const measure of plan) {
        const segment = harmonyPlan[measure.index]?.segments[0];
        const chordTones = segment?.pool.chordPitchClasses ?? fallbackTriad;
        const avoid = new Set(segment?.pool.avoidPitchClasses ?? []);
        const nonAvoid = segment
            ? segment.pool.availablePitchClasses.filter(pitchClass => !avoid.has(pitchClass))
            : [];
        const weakTargets = nonAvoid.length > 0 ? nonAvoid : chordTones;
        const soundingCount = measure.slots.filter(slot => !slot.isRest).length;
        let soundingIndex = 0;

        for (let slotIndex = 0; slotIndex < measure.slots.length; slotIndex++) {
            const slot = measure.slots[slotIndex];
            if (slot.isRest) {
                result.push({
                    measureIndex: measure.index,
                    slotIndex,
                    duration: slot.duration,
                    isRest: true,
                    midis: [],
                    role: slot.role,
                });
                continue;
            }

            const isFirstOfMeasure = soundingIndex === 0;
            const isLastOfMeasure = soundingIndex === soundingCount - 1;
            const isFinal = measure.index === plan.length - 1 && isLastOfMeasure;

            let midi: number;
            if (previousMidi === null) {
                midi = nearestMidiWithPitchClasses(
                    register.center, chordTones, register.low, register.high,
                ) ?? register.midis[nearestIndex(register.midis, register.center)];
            } else if (isFirstOfMeasure) {
                // 新小节从稳定音起句：贴着上一个音找当前和弦音，不另起一个远把位
                midi = snapToPitchClasses(
                    previousMidi, previousMidi, chordTones,
                    register.low, register.high, maxLeap,
                );
            } else {
                const step = rng() < style.repetitionProbability
                    ? motifSteps[(soundingIndex - 1) % motifSteps.length]
                    : randomStep(rng);
                midi = stepFrom(previousMidi, step, register.midis, maxLeap);
            }

            if (isFinal) {
                midi = resolveToTonic(
                    previousMidi ?? midi, options.tonicPitchClass,
                    register.playLow, register.playHigh, maxLeap, finalMaxLeap,
                );
            } else if (slot.role === 'strong' || isLastOfMeasure) {
                midi = snapToPitchClasses(
                    midi, previousMidi ?? midi, chordTones,
                    register.low, register.high, maxLeap,
                );
            } else if (slot.role !== 'passing' && avoid.has(pitchClassOf(midi))) {
                // 弱拍长音不留在 avoid note 上；短经过音（passing）允许。
                // 搜索窗口必须以 previousMidi 为中心：midi 可能已经离上一个音
                // 一个 maxLeap，再围绕 midi 搜索会让最终落点离上一个音两倍超限。
                midi = snapToPitchClasses(
                    midi, previousMidi ?? midi, weakTargets,
                    register.low, register.high, maxLeap,
                );
            }

            result.push({
                measureIndex: measure.index,
                slotIndex,
                duration: slot.duration,
                isRest: false,
                midis: [midi],
                role: slot.role,
            });
            previousMidi = midi;
            soundingIndex++;
        }
    }

    return result;
}
