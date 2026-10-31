/**
 * melody — 在调内生成旋律骨架（纯函数）。
 *
 * 这一步只决定“弹什么音高”，不决定“在哪根弦上弹”；把位由 positioning DP 负责。
 * 骨架用音阶级数做随机游走，并用一个短动机重复/变化，避免听起来像无序音阶练习。
 */

import type {
    HarmonyMeasure,
    PhrasePlan,
    PlayabilityRules,
    ResolvedImprovOptions,
    RhythmMeasure,
    SkeletonSlot,
    StyleProfile,
} from '../../types/improv.ts';
import { buildHarmonyPlan } from './harmony.ts';
import { pickWeighted } from './random.ts';
import {
    midiRangeForFretRange,
    midiToFretPositions,
    nearestMidiWithPitchClasses,
    pitchClassOf,
    playableMidiRange,
    scaleMidisInRange,
    tonicTriadPitchClasses,
} from './pitch.ts';

interface Register {
    midis: number[];
    low: number;
    high: number;
    center: number;
    playLow: number;
    playHigh: number;
}

/** 旋律中心附近的可选 MIDI */
function buildRegister(
    options: ResolvedImprovOptions,
    style: StyleProfile,
    playability: PlayabilityRules,
): Register {
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

/**
 * 按乐句把位窗口构造音区。
 *
 * 窗口内的调内音优先；若窗口里没有可落位的调内音（极窄把位），
 * 回落到全局音区并在校验层由约束兜底。
 */
function buildPhraseRegister(
    phrase: PhrasePlan,
    options: ResolvedImprovOptions,
    playability: PlayabilityRules,
    fallback: Register,
): Register {
    const fretMin = Math.max(playability.fretMin, phrase.fretMin);
    const fretMax = Math.min(playability.fretMax, phrase.fretMax);
    if (fretMax < fretMin) return fallback;

    const [rangeLow, rangeHigh] = midiRangeForFretRange(
        options.tuning, fretMin, fretMax,
    );
    const midis = scaleMidisInRange(
        options.tonicPitchClass, options.scaleType, rangeLow, rangeHigh,
    ).filter(midi => midiToFretPositions(
        options.tuning, midi, fretMin, fretMax,
    ).length > 0);

    if (midis.length === 0) return fallback;

    const low = midis[0];
    const high = midis[midis.length - 1];
    return {
        midis,
        low,
        high,
        center: (low + high) / 2,
        playLow: fallback.playLow,
        playHigh: fallback.playHigh,
    };
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
 * 句首/稳定音吸附：优先在单步音程内找目标和弦音，找不到再在整个
 * 乐句音区里找最近的——句首允许比句内略大的跳进，否则会卡在非和弦音上。
 */
function snapOrNearest(
    candidate: number,
    current: number,
    pitchClasses: readonly number[],
    low: number,
    high: number,
    maxLeap: number,
): number {
    const min = Math.max(low, current - maxLeap);
    const max = Math.min(high, current + maxLeap);
    const nearby = nearestMidiWithPitchClasses(
        candidate, pitchClasses, min, max,
    );
    if (nearby !== null) return nearby;
    return nearestMidiWithPitchClasses(candidate, pitchClasses, low, high)
        ?? candidate;
}

/**
 * 句尾落到主音。
 *
 * 第一搜索范围是「当前音 ± 风格上限」，并且限定在整条指板的可演奏范围，
 * 而不是风格音区：风格音区可能把附近的主音排除在外（例如 D 大调里
 * D3=50 在 Jazz 音区下方），于是只能跳到更远的 D4，产生超限跳进。
 * 若风格上限内确实没有主音，再放宽到句间/收束上限；仍找不到时以主音
 * 为准（允许略超上限），这个例外只作用于全曲最后一个音。
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
    const relaxed = nearestMidiWithPitchClasses(
        current, [tonicPitchClass], finalMin, finalMax,
    );
    if (relaxed !== null) return relaxed;

    // 收束必须落在主音：音域边界附近（如标准调弦最低的 E2 到最近的 C3
    // 相距 8 个半音）可能超出放宽后的上限，此时以主音为准，交由校验层
    // 判断这次跳进是否仍可演奏。
    return nearestMidiWithPitchClasses(
        current, [tonicPitchClass], playLow, playHigh,
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
    phrases?: readonly PhrasePlan[],
): SkeletonSlot[] {
    if (phrases !== undefined && phrases.length > 0) {
        return buildSkeletonPhrased(
            plan, options, style, playability, rng, harmony, phrases,
        );
    }

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

/**
 * 乐句感知的旋律生成。
 *
 * 与逐小节版本的区别：
 * - 级数步在整句内连续推进，不在小节边界重置；
 * - 每句有自己的把位窗口/音区；
 * - 句首、小节末、句末是锚点，锚点优先落在和弦音上；
 * - answer 复用 statement 的句头，development 用模进/反向，cadence 收尾。
 */
function buildSkeletonPhrased(
    plan: RhythmMeasure[],
    options: ResolvedImprovOptions,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
    harmony: readonly HarmonyMeasure[] | undefined,
    phrases: readonly PhrasePlan[],
): SkeletonSlot[] {
    const fallbackRegister = buildRegister(options, style, playability);
    const harmonyPlan = harmony ?? buildHarmonyPlan(options);
    const fallbackTriad = tonicTriadPitchClasses(
        options.tonicPitchClass, options.scaleType,
    );
    const maxLeap = Math.max(1, Math.min(
        style.maxLeapSemitones, playability.maxLeapSemitones,
    ));
    // 句间换把与全曲收束允许放宽到换把上限，句内仍守风格上限。
    const boundaryMaxLeap = Math.max(maxLeap, playability.maxPhraseLeapSemitones);
    const finalMaxLeap = boundaryMaxLeap;

    const result: SkeletonSlot[] = [];
    let previousMidi: number | null = null;

    phrases.forEach((phrase, phraseIndex) => {
        const register = buildPhraseRegister(
            phrase, options, playability, fallbackRegister,
        );
        const phraseMeasures = plan.filter(measure =>
            measure.index >= phrase.startMeasure
            && measure.index < phrase.endMeasure);
        const phraseSoundingCount = phraseMeasures.reduce(
            (count, measure) =>
                count + measure.slots.filter(slot => !slot.isRest).length,
            0,
        );
        if (phraseSoundingCount === 0) return;

        let phraseSoundingIndex = 0;
        let phraseStepIndex = 0;
        let sameNoteRun = 0;
        const isFirstPhrase = phraseIndex === 0;
        const isLastPhrase = phraseIndex === phrases.length - 1;

        for (const measure of phraseMeasures) {
            const segment = harmonyPlan[measure.index]?.segments[0];
            const chordTones = segment?.pool.chordPitchClasses ?? fallbackTriad;
            const avoid = new Set(segment?.pool.avoidPitchClasses ?? []);
            const nonAvoid = segment
                ? segment.pool.availablePitchClasses.filter(
                    pitchClass => !avoid.has(pitchClass))
                : [];
            const weakTargets = nonAvoid.length > 0 ? nonAvoid : chordTones;
            const measureSoundingCount = measure.slots
                .filter(slot => !slot.isRest).length;
            let measureSoundingIndex = 0;

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
                        phraseIndex,
                    });
                    continue;
                }

                const isFirstOfPhrase = phraseSoundingIndex === 0;
                const isLastOfPhrase = phraseSoundingIndex === phraseSoundingCount - 1;
                const isLastOfMeasure = measureSoundingIndex === measureSoundingCount - 1;
                const isFinal = isLastPhrase && isLastOfPhrase;
                const previous = previousMidi;

                let midi: number;
                if (isFirstOfPhrase) {
                    if (isFirstPhrase || previous === null) {
                        midi = nearestMidiWithPitchClasses(
                            register.center, chordTones,
                            register.low, register.high,
                        ) ?? register.midis[nearestIndex(register.midis, register.center)];
                    } else {
                        const shift = Math.max(
                            -boundaryMaxLeap,
                            Math.min(
                                boundaryMaxLeap,
                                phrase.transposeSteps * 2 + phrase.registerShift,
                            ),
                        );
                        midi = previous + shift;
                    }
                } else if (previous !== null) {
                    const step = phrase.steps[
                        phraseStepIndex % phrase.steps.length
                    ];
                    phraseStepIndex++;
                    midi = stepFrom(previous, step, register.midis, maxLeap);
                } else {
                    midi = register.midis[nearestIndex(register.midis, register.center)];
                }

                if (isFinal) {
                    midi = resolveToTonic(
                        previous ?? midi, options.tonicPitchClass,
                        register.playLow, register.playHigh, maxLeap, finalMaxLeap,
                    );
                } else if (isFirstOfPhrase) {
                    // 句首换把允许放宽，但只吸附一次，避免二次吸附把音推回远处。
                    midi = snapOrNearest(
                        midi, previous ?? midi, chordTones,
                        register.low, register.high, boundaryMaxLeap,
                    );
                } else if (slot.role === 'strong' || isLastOfMeasure || isLastOfPhrase) {
                    midi = snapOrNearest(
                        midi, previous ?? midi, chordTones,
                        register.low, register.high, maxLeap,
                    );
                } else if (slot.role !== 'passing' && avoid.has(pitchClassOf(midi))) {
                    midi = snapToPitchClasses(
                        midi, previous ?? midi, weakTargets,
                        register.low, register.high, maxLeap,
                    );
                }

                // 机械同音：同音最多连续两次；强拍/锚点上的和弦音重复是稳定的，
                // 不做移位，避免把已经吸附好的和弦音又推开。
                const isAnchor = slot.role === 'strong' || isLastOfMeasure || isLastOfPhrase;
                if (previous !== null && midi === previous
                    && !isAnchor && slot.role !== 'passing') {
                    sameNoteRun++;
                    if (sameNoteRun >= 2) {
                        const direction = rng() < 0.5 ? 1 : -1;
                        const first = stepFrom(
                            previous, direction, register.midis, maxLeap,
                        );
                        const second = stepFrom(
                            previous, -direction, register.midis, maxLeap,
                        );
                        // 音区边缘时 stepFrom 会夹回同一个音，这种邻音不能用来
                        // 打破同音，否则计数清零后又会立刻累计出三连。
                        const canUseFirst = first !== previous
                            && !avoid.has(pitchClassOf(first));
                        const canUseSecond = second !== previous
                            && !avoid.has(pitchClassOf(second));
                        if (canUseFirst) {
                            midi = first;
                        } else if (canUseSecond) {
                            midi = second;
                        } else {
                            // 两侧邻音都不可用时，退回最近的弱拍目标音；
                            // 排除同音高，保证确实离开 previous。
                            const alternatives = weakTargets.filter(
                                pitchClass => pitchClass !== pitchClassOf(previous),
                            );
                            midi = nearestMidiWithPitchClasses(
                                previous,
                                alternatives.length > 0 ? alternatives : weakTargets,
                                Math.max(register.low, previous - maxLeap),
                                Math.min(register.high, previous + maxLeap),
                            ) ?? previous;
                        }
                        sameNoteRun = 0;
                    }
                } else {
                    sameNoteRun = 0;
                }

                result.push({
                    measureIndex: measure.index,
                    slotIndex,
                    duration: slot.duration,
                    isRest: false,
                    midis: [midi],
                    role: slot.role,
                    phraseIndex,
                });
                previousMidi = midi;
                phraseSoundingIndex++;
                measureSoundingIndex++;
            }
        }
    });

    return result;
}
