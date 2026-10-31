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
} from '../../types/improv.ts';
import {
    LOCAL_DENSITIES,
    LOCAL_STYLES,
    SCALE_TYPES,
} from '../../types/improv.ts';
import { LOCAL_IMPROV_CONFIG } from '../../config.ts';
import { capacityFromTimeSignature } from '../measureUtils.ts';
import { decorateSlots } from './decorate.ts';
import { buildHarmonyPlan, normalizeProgression } from './harmony.ts';
import { buildSkeleton } from './melody.ts';
import { buildPhrasePlan, validatePhrasePlan } from './phrase.ts';
import {
    midiRangeForFretRange,
    midiToFretPositions,
    parseKey,
    pitchClassOf,
} from './pitch.ts';
import {
    formatChordSpec,
    normalizeChordChart,
} from './progression.ts';
import { choosePositions } from './positioning.ts';
import { createRng } from './random.ts';
import { buildRhythmPlan } from './rhythm.ts';
import { validateNotes, validatePlan } from './validate.ts';

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

/** 把用户输入补齐成完整选项；非法值回落到默认值 */
export function resolveLocalImprovOptions(
    input: Partial<ImprovOptions> = {},
    config: LocalImprovConfig = LOCAL_IMPROV_CONFIG,
): ResolvedImprovOptions {
    const rawKey = typeof input.key === 'string' ? input.key.trim() : '';
    const parsedKey = parseKey(rawKey) ?? parseKey(config.defaults.key);
    if (parsedKey === null) {
        throw new Error(`默认调性无法解析: ${config.defaults.key}`);
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

    return {
        numMeasures,
        key: parsedKey.key,
        tonicPitchClass: parsedKey.tonicPitchClass,
        scaleType,
        style,
        density,
        timeSignature,
        tuning: isTuning(input.tuning)
            ? { ...input.tuning }
            : { ...config.defaults.tuning },
        progression: normalizeProgression(input.progression),
        chordChart: normalizeChordChart(input.chordChart, numMeasures, capacity),
        fretRange: resolveFretRange(input.fretRange, config),
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
                throw new Error(
                    `锁定把位 ${range.min}-${range.max} 品内没有和弦 `
                    + `${label} 的可演奏音，请放宽把位范围`,
                );
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
    const style = config.styleProfiles[options.style];
    const harmony = buildHarmonyPlan(options);
    assertLockedChordsPlayable(harmony, options);

    const phrases = buildPhrasePlan(
        options, style, config.playability, createRng(options.seed + 4),
    );
    const phraseErrors = validatePhrasePlan(phrases, options);
    if (phraseErrors.length > 0) {
        throw new Error(`本地即兴乐句计划无效:\n${phraseErrors.join('\n')}`);
    }

    const plan = buildRhythmPlan(
        options, density, style, createRng(options.seed), phrases,
    );
    const planErrors = validatePlan(
        plan, options, density.minNotesPerMeasure,
    );
    if (planErrors.length > 0) {
        throw new Error(`本地即兴节奏计划无效:\n${planErrors.join('\n')}`);
    }

    const skeleton = buildSkeleton(
        plan, options, style, config.playability,
        createRng(options.seed + 1), harmony, phrases,
    );
    const positioned = choosePositions(
        skeleton, options, config.playability, style,
    );
    const notes = decorateSlots(
        positioned, style, config.playability,
        createRng(options.seed + 2),
    );

    const noteErrors = validateNotes(
        notes, options, config.playability,
        Math.min(style.maxLeapSemitones, config.playability.maxLeapSemitones),
        harmony,
        phrases,
    );
    if (noteErrors.length > 0) {
        throw new Error(`本地即兴结果未通过校验:\n${noteErrors.join('\n')}`);
    }

    return { notes, options, harmony, phrases };
}
