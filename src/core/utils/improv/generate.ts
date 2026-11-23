/**
 * generate — 本地即兴的编排入口。
 *
 * 链路固定为：补默认值 → 和声计划 → 节奏规则 → 旋律规则 → 把位 DP → 演奏层 → 校验。
 * 全程无网络、无 DOM；同一组选项与 seed 必然得到同一份谱面。
 */

import type { Tuning } from '../../types/index.ts';
import type {
    FretRange,
    ImprovOptions,
    LocalImprovConfig,
    LocalImprovResult,
    ResolvedImprovOptions,
} from '../../types/improv/index.ts';
import {
    FINGERING_PATTERNS,
    LOCAL_DENSITIES,
    LOCAL_STYLES,
    PRACTICE_FOCUSES,
    SCALE_TYPES,
} from '../../types/improv/index.ts';
import { FINGERING_PATTERN_SPAN, LOCAL_IMPROV_CONFIG } from '../../config.ts';
import { capacityFromTimeSignature } from '../measureUtils.ts';
import { t } from '../../i18n/index.ts';
import { decorateSlots } from './decorate.ts';
import { fingeringFretRange } from './fingering.ts';
import { buildHarmonyPlan, normalizeProgression } from './harmony.ts';
import { buildSkeleton } from './melody.ts';
import { buildPhrasePlan, validatePhrasePlan } from './phrase.ts';
import {
    midiRangeForFretRange,
    midiToFretPositions,
    parseKey,
    pitchClassOf,
} from './pitch.ts';
import { applyPracticeProfile } from './practice.ts';
import {
    formatChordSpec,
    normalizeChordChart,
} from './progression.ts';
import { choosePositions } from './positioning.ts';
import { createRng } from './random.ts';
import { applyCadence, buildRhythmPlan } from './rhythm.ts';
import { validateNotes, validatePlan } from './validate.ts';
import { addVoicings } from './voicing.ts';

function isTuning(value: unknown): value is Tuning {
    if (typeof value !== 'object' || value === null) return false;
    return ['string1', 'string2', 'string3', 'string4', 'string5', 'string6']
        .every(key => typeof (value as Record<string, unknown>)[key] === 'string');
}

function resolveNumMeasures(
    value: number | undefined,
    config: LocalImprovConfig,
): number {
    const fallback = config.defaults.numMeasures;
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.max(
        config.numMeasures.min,
        Math.min(config.numMeasures.max, Math.round(value)),
    );
}

/** 把外部把位范围夹到可演奏范围内；缺省或非法返回 null（交给风格偏好） */
function resolveFretRange(
    value: unknown,
    config: LocalImprovConfig,
): FretRange | null {
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as Partial<FretRange>;
    if (candidate.min === undefined || candidate.max === undefined) return null;
    if (!Number.isFinite(candidate.min) || !Number.isFinite(candidate.max)) {
        return null;
    }

    const clamp = (fret: number): number => Math.max(
        config.playability.fretMin,
        Math.min(config.playability.fretMax, Math.round(fret)),
    );
    let min = clamp(candidate.min);
    let max = clamp(candidate.max);
    if (min > max) [min, max] = [max, min];
    return { min, max };
}

/**
 * 练习模式（keepPosition）的默认把位：风格低把位起、最多 4 品。
 *
 * 显式 fretRange 与指型都不在时才用；窗口仍夹到可演奏范围内。
 */
function resolvePracticeFretRange(
    preferredMin: number,
    preferredMax: number,
    config: LocalImprovConfig,
): FretRange {
    const clamp = (fret: number): number => Math.max(
        config.playability.fretMin,
        Math.min(config.playability.fretMax, Math.round(fret)),
    );
    let min = clamp(preferredMin);
    let max = clamp(Math.min(preferredMax, preferredMin + FINGERING_PATTERN_SPAN - 1));
    if (min > max) [min, max] = [max, min];
    return { min, max };
}

/** 把用户输入补齐成完整选项；非法值回落到默认值 */
export function resolveLocalImprovOptions(
    input: Partial<ImprovOptions> = {},
    config: LocalImprovConfig = LOCAL_IMPROV_CONFIG,
): ResolvedImprovOptions {
    const rawKey = typeof input.key === 'string' ? input.key.trim() : '';
    const parsedKey = parseKey(rawKey) ?? parseKey(config.defaults.key);
    if (parsedKey === null) {
        throw new Error(t('improv.generate.defaultKeyInvalid', { key: config.defaults.key }));
    }

    const style = input.style !== undefined && LOCAL_STYLES.includes(input.style)
        ? input.style
        : config.defaults.style;
    const scaleType = input.scaleType !== undefined && SCALE_TYPES.includes(input.scaleType)
        ? input.scaleType
        : config.defaults.scaleType;
    const density = input.density !== undefined && LOCAL_DENSITIES.includes(input.density)
        ? input.density
        : config.defaults.density;
    const timeSignature = input.timeSignature !== undefined
        && config.timeSignatures.includes(input.timeSignature)
        && Number.isFinite(capacityFromTimeSignature(input.timeSignature))
        ? input.timeSignature
        : config.defaults.timeSignature;

    const seed = input.seed !== undefined && Number.isFinite(input.seed)
        ? Math.trunc(input.seed)
        : config.defaults.seed;
    const numMeasures = resolveNumMeasures(input.numMeasures, config);
    const capacity = capacityFromTimeSignature(timeSignature);
    const tuning = isTuning(input.tuning)
        ? { ...input.tuning }
        : { ...config.defaults.tuning };

    const practice = input.practice !== undefined && PRACTICE_FOCUSES.includes(input.practice)
        ? input.practice
        : 'none';
    const fingering = input.fingering !== undefined && FINGERING_PATTERNS.includes(input.fingering)
        ? input.fingering
        : null;

    // 把位来源优先级：显式 > 指型 > 练习锁定 > 风格偏好
    let fretRange = resolveFretRange(input.fretRange, config);
    let fretRangeSource: ResolvedImprovOptions['fretRangeSource'] = 'explicit';
    if (fretRange === null && fingering !== null) {
        fretRange = fingeringFretRange(
            fingering, parsedKey.tonicPitchClass, scaleType,
            tuning, config.playability, FINGERING_PATTERN_SPAN,
        );
        if (fretRange !== null) fretRangeSource = 'fingering';
    }
    if (fretRange === null && config.practiceProfiles[practice].keepPosition) {
        const preferred = config.styleProfiles[style];
        fretRange = resolvePracticeFretRange(
            preferred.preferredFretMin, preferred.preferredFretMax, config,
        );
        fretRangeSource = 'practice';
    }
    if (fretRange === null) fretRangeSource = 'style';

    return {
        numMeasures,
        key: parsedKey.key,
        tonicPitchClass: parsedKey.tonicPitchClass,
        scaleType,
        style,
        density,
        timeSignature,
        tuning,
        progression: normalizeProgression(input.progression),
        chordChart: normalizeChordChart(input.chordChart, numMeasures, capacity),
        fretRange,
        fretRangeSource,
        fingering,
        practice,
        seed,
    };
}

/**
 * 锁定把位下，每个和弦至少要有可弹的 chord tone。
 *
 * 否则强拍/段首规则必然无解，后续只会抛笼统的「未通过校验」。提前
 * 用可读错误说明是窗口太窄，而不是生成器坏了。
 */
function assertLockedChordsPlayable(
    harmony: ReturnType<typeof buildHarmonyPlan>,
    options: ResolvedImprovOptions,
): void {
    const range = options.fretRange;
    if (!range) return;

    const [low, high] = midiRangeForFretRange(
        options.tuning, range.min, range.max,
    );
    const checked = new Set<string>();

    for (const measure of harmony) {
        for (const segment of measure.segments) {
            const label = formatChordSpec(segment.chord);
            if (checked.has(label)) continue;
            checked.add(label);

            const playable = segment.pool.chordPitchClasses.some(pitchClass => {
                for (let midi = Math.ceil(low); midi <= Math.floor(high); midi++) {
                    if (pitchClassOf(midi) !== pitchClass
                        || midiToFretPositions(
                            options.tuning, midi, range.min, range.max,
                        ).length === 0) {
                        continue;
                    }
                    return true;
                }
                return false;
            });

            if (!playable) {
                throw new Error(t('improv.generate.lockedRangeNoVoicing', {
                    min: range.min,
                    max: range.max,
                    chord: label,
                }));
            }
        }
    }
}

/**
 * 本地生成一段即兴。
 *
 * @throws 当节奏计划或最终 Note[] 未通过校验（说明生成器内部契约破裂）
 */
export function generateLocalImprovisation(
    input: Partial<ImprovOptions> = {},
    config: LocalImprovConfig = LOCAL_IMPROV_CONFIG,
): LocalImprovResult {
    const options = resolveLocalImprovOptions(input, config);
    const density = config.densityProfiles[options.density];
    const style = applyPracticeProfile(
        config.styleProfiles[options.style], options.practice, config.practiceProfiles,
    );
    const maxLeapSemitones = Math.min(
        style.maxLeapSemitones, config.playability.maxLeapSemitones,
    );
    const harmony = buildHarmonyPlan(options);
    assertLockedChordsPlayable(harmony, options);

    const phrases = buildPhrasePlan(
        options, style, config.playability, createRng(options.seed + 4),
    );
    const phraseErrors = validatePhrasePlan(phrases, options);
    if (phraseErrors.length > 0) {
        throw new Error(t('improv.generate.phrasePlanInvalid', {
            errors: phraseErrors.join('\n'),
        }));
    }

    // 终止式在节奏层完成：末小节尾部重排成一个长收尾音，旋律与把位仍按
    // 同一份计划推进，两种播放引擎也不用各自猜测「结尾该拖多长」。
    const plan = applyCadence(
        buildRhythmPlan(
            options, density, style, createRng(options.seed), phrases,
        ),
        options,
        harmony,
        style.phrase.cadenceMinDuration,
    );
    const planErrors = validatePlan(
        plan, options, density.minNotesPerMeasure,
    );
    if (planErrors.length > 0) {
        throw new Error(t('improv.generate.rhythmPlanInvalid', {
            errors: planErrors.join('\n'),
        }));
    }

    const skeleton = buildSkeleton(
        plan, options, style, config.playability,
        createRng(options.seed + 1), harmony, phrases,
    );
    // 声部层单独用一条随机流，不占用 rhythm/melody/phrase/decorate 的序列；
    // 多声部拍位会让演奏层多掷 strum/arpeggio，因此演奏层结果可能随声部层变化。
    const voicedSkeleton = addVoicings(
        skeleton, harmony, options, style, config.playability,
        createRng(options.seed + 5),
    );
    const positioned = choosePositions(
        voicedSkeleton, options, config.playability, style,
    );
    const notes = decorateSlots(
        positioned, style, config.playability,
        createRng(options.seed + 2),
    );

    const noteErrors = validateNotes(
        notes, options, config.playability,
        maxLeapSemitones,
        harmony,
        phrases,
    );
    if (noteErrors.length > 0) {
        throw new Error(t('improv.generate.resultInvalid', {
            errors: noteErrors.join('\n'),
        }));
    }

    return { notes, options, harmony, phrases, maxLeapSemitones };
}
