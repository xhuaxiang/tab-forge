/**
 * generate — 本地即兴的编排入口。
 *
 * 链路固定为：补默认值 → 和声计划 → 节奏规则 → 旋律规则 → 把位 DP → 演奏层 → 校验。
 * 全程无网络、无 DOM；同一组选项与 seed 必然得到同一份谱面。
 */

import type { Tuning } from '../../types/index.ts';
import type {
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
import { parseKey } from './pitch.ts';
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

    return {
        numMeasures: resolveNumMeasures(input.numMeasures, config),
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
        seed,
    };
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

    const plan = buildRhythmPlan(
        options, density, style, createRng(options.seed),
    );
    const planErrors = validatePlan(
        plan, options, density.minNotesPerMeasure,
    );
    if (planErrors.length > 0) {
        throw new Error(`本地即兴节奏计划无效:\n${planErrors.join('\n')}`);
    }

    const skeleton = buildSkeleton(
        plan, options, style, config.playability,
        createRng(options.seed + 1), harmony,
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
    );
    if (noteErrors.length > 0) {
        throw new Error(`本地即兴结果未通过校验:\n${noteErrors.join('\n')}`);
    }

    return { notes, options, harmony };
}
