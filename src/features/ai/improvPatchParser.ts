/**
 * improvPatchParser — 解析「表现扩展」阶段 AI 返回的 JSON。
 *
 * 逐条白名单校验：未知字段忽略，非法值只丢该字段，结构非法的整条丢弃。
 * 音高/时值/分组字段根本没有落点（`PerformancePatch` 不含这些键），
 * `targetFret` 额外给 warning —— 连接技法的目标品就是目标音自身的 fret。
 */

import type { PerformancePatch } from '../../core/types/improv/index.ts';
import { normalizeHarmonicFret } from '../../core/utils/scoreMapping.ts';
import {
    HARMONIC_FRET_MAX,
    HARMONIC_FRET_MIN,
    LOCAL_IMPROV_CONFIG,
} from '../../core/config.ts';
import { t } from '../../core/i18n/index.ts';
import {
    isAIBendAmount,
    isAIDynamics,
    isAIHarmonic,
    isAITechnique,
} from './contractConstants.ts';
import { extractJsonObject } from './jsonExtract.ts';

/** AI 返回的单条补丁原文（取值一律按不可信处理） */
interface RawPatch {
    measureIndex?: unknown;
    slotIndex?: unknown;
    dynamics?: unknown;
    technique?: unknown;
    bendAmount?: unknown;
    bendRelease?: unknown;
    palmMute?: unknown;
    deadNote?: unknown;
    letRing?: unknown;
    staccato?: unknown;
    harmonic?: unknown;
    harmonicFret?: unknown;
    arpeggio?: unknown;
    strum?: unknown;
}

/** 禁止出现在补丁里的字段（仅用于 warning 与编译期护栏） */
type ForbiddenPatchKey =
    | 'string'
    | 'fret'
    | 'duration'
    | 'isRest'
    | 'chordGroup'
    | 'targetFret'
    | 'chordName'
    | 'tieToNext';

type _AssertTrue<T extends true> = T;

/**
 * 编译期护栏：`RawPatch` 的字段必须是 `PerformancePatch` 的子集。
 *
 * `PerformancePatch` 也绝不能长出禁止字段；两条护栏一起防止后续悄悄
 * 把音高/时值字段加回契约。
 */
export type _RawPatchFieldsArePatchFields = _AssertTrue<
    keyof RawPatch extends keyof PerformancePatch ? true : false
>;
export type _PatchHasNoForbiddenFields = _AssertTrue<
    Extract<keyof PerformancePatch, ForbiddenPatchKey> extends never ? true : false
>;

export interface ImprovPatchParseResult {
    patches: PerformancePatch[];
    warnings: string[];
    error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickBoolean(value: unknown): boolean | null | undefined {
    if (value === null) return null;
    return typeof value === 'boolean' ? value : undefined;
}

function pickDirection(value: unknown): 'up' | 'down' | null | undefined {
    if (value === null) return null;
    return value === 'up' || value === 'down' ? value : undefined;
}

/**
 * 校验单条补丁的结构字段。
 *
 * @returns 补丁或 null（结构非法）；非法字段的 warning 由调用方统一收集。
 */
function sanitizePatch(
    raw: unknown,
    index: number,
    warnings: string[],
): PerformancePatch | null {
    if (!isRecord(raw)) {
        warnings.push(t('ai.warn.patchNotObject', { index: index + 1 }));
        return null;
    }

    const source = raw as RawPatch;
    const measureIndex = source.measureIndex;
    const slotIndex = source.slotIndex;
    if (typeof measureIndex !== 'number' || !Number.isInteger(measureIndex)
        || measureIndex < 0
        || typeof slotIndex !== 'number' || !Number.isInteger(slotIndex)
        || slotIndex < 0) {
        warnings.push(t('ai.warn.patchIndexInvalid', { index: index + 1 }));
        return null;
    }

    const patch: PerformancePatch = { measureIndex, slotIndex };
    const label = t('ai.warn.patchLabel', { index: index + 1 });

    if (source.dynamics !== undefined) {
        if (source.dynamics === null) patch.dynamics = null;
        else if (isAIDynamics(source.dynamics)) patch.dynamics = source.dynamics;
        else warnings.push(t('ai.warn.dynamicsInvalid', {
            label,
            value: String(source.dynamics),
        }));
    }
    if (source.technique !== undefined) {
        if (source.technique === null) patch.technique = null;
        else if (isAITechnique(source.technique)) patch.technique = source.technique;
        else warnings.push(t('ai.warn.techniqueInvalid', {
            label,
            value: String(source.technique),
        }));
    }
    if (source.bendAmount !== undefined) {
        if (isAIBendAmount(source.bendAmount)) patch.bendAmount = source.bendAmount;
        else warnings.push(t('ai.warn.bendAmountInvalid', { label }));
    }
    if (source.bendRelease !== undefined) {
        if (typeof source.bendRelease === 'boolean') patch.bendRelease = source.bendRelease;
        else warnings.push(t('ai.warn.bendReleaseNotBoolean', { label }));
    }

    for (const field of ['palmMute', 'deadNote', 'letRing', 'staccato'] as const) {
        const value = pickBoolean(source[field]);
        if (value === undefined) {
            if (source[field] !== undefined) {
                warnings.push(t('ai.warn.fieldNotBooleanOrNull', { label, field }));
            }
        } else {
            patch[field] = value;
        }
    }

    if (source.harmonic !== undefined) {
        if (source.harmonic === null) patch.harmonic = null;
        else if (isAIHarmonic(source.harmonic)) patch.harmonic = source.harmonic;
        else warnings.push(t('ai.warn.harmonicInvalid', {
            label,
            value: String(source.harmonic),
        }));
    }
    if (source.harmonicFret !== undefined) {
        const fret = source.harmonicFret;
        if (typeof fret === 'number' && Number.isInteger(fret)
            && fret >= HARMONIC_FRET_MIN && fret <= HARMONIC_FRET_MAX) {
            // 表外节点（6/11/13…）按 12 品发声；存值与播放保持一致。
            // 归一化后仍须落在可演奏白名单里，否则 validateNotes 会拒整条补丁。
            const normalized = normalizeHarmonicFret(fret);
            if (LOCAL_IMPROV_CONFIG.playability.harmonicFrets.includes(normalized)) {
                patch.harmonicFret = normalized;
            } else {
                warnings.push(t('ai.warn.harmonicFretOutOfRange', {
                    label,
                    fret,
                    frets: LOCAL_IMPROV_CONFIG.playability.harmonicFrets.join(' / '),
                }));
            }
        } else {
            warnings.push(t('ai.warn.harmonicFretInvalid', { label }));
        }
    }

    if (source.arpeggio !== undefined) {
        const value = pickDirection(source.arpeggio);
        if (value === undefined) warnings.push(t('ai.warn.arpeggioInvalid', { label }));
        else patch.arpeggio = value;
    }
    if (source.strum !== undefined) {
        const value = pickDirection(source.strum);
        if (value === undefined) warnings.push(t('ai.warn.strumInvalid', { label }));
        else patch.strum = value;
    }

    // targetFret 是旧契约遗留：应用器没有落点，提示一次即可
    if ('targetFret' in raw) {
        warnings.push(t('ai.warn.targetFretIgnored', { label }));
    }

    return patch;
}

/**
 * 解析 patch 响应。
 *
 * @param maxPatches 最多保留多少条（其余截断并给 warning）
 */
export function parseImprovPatchesResponse(
    text: string,
    maxPatches: number,
): ImprovPatchParseResult {
    const parsed = extractJsonObject(text);
    if (!isRecord(parsed) || !Array.isArray(parsed.patches)) {
        return {
            patches: [],
            warnings: [],
            error: t('ai.error.missingPatches'),
        };
    }

    const warnings: string[] = [];
    const patches: PerformancePatch[] = [];
    for (const [index, raw] of parsed.patches.entries()) {
        const patch = sanitizePatch(raw, index, warnings);
        if (patch !== null) patches.push(patch);
    }

    if (!Number.isFinite(maxPatches) || maxPatches < 0) {
        return { patches, warnings };
    }
    const limit = Math.floor(maxPatches);
    if (patches.length > limit) {
        warnings.push(t('ai.warn.tooManyPatches', { limit }));
        return { patches: patches.slice(0, limit), warnings };
    }
    return { patches, warnings };
}
