/**
 * improvBriefParser — 解析「需求解析」阶段 AI 返回的 JSON。
 *
 * AI 输出一律按不可信处理：逐字段白名单校验，非法字段单独丢弃，
 * 不因为一个字段坏了就整包失败。`options` 缺失或 JSON 非法才返回 error。
 */

import type {
    FretRange,
    FingeringPattern,
    ImprovBriefOptions,
    LocalDensity,
    LocalStyle,
    PracticeFocus,
    Progression,
    ScaleType,
} from '../../core/types/improv/index.ts';
import {
    FINGERING_PATTERNS,
    LOCAL_DENSITIES,
    LOCAL_STYLES,
    PRACTICE_FOCUSES,
    SCALE_TYPES,
} from '../../core/types/improv/index.ts';
import { LOCAL_IMPROV_CONFIG } from '../../core/config.ts';
import { parseKey } from '../../core/utils/improv/pitch.ts';
import { parseProgressionText } from '../../core/utils/improv/progression.ts';
import { extractJsonObject } from './jsonExtract.ts';

/** AI 返回的 options 原文（取值一律按不可信处理） */
interface RawBriefOptions {
    key?: unknown;
    scaleType?: unknown;
    style?: unknown;
    density?: unknown;
    numMeasures?: unknown;
    timeSignature?: unknown;
    fingering?: unknown;
    fretRange?: unknown;
    progression?: unknown;
    chordsPerMeasure?: unknown;
}

/** AI 返回的完整结构 */
interface RawBrief {
    options?: unknown;
    practice?: unknown;
    unsupported?: unknown;
    rationale?: unknown;
}

export interface ImprovBriefParseResult {
    options: ImprovBriefOptions;
    /** AI 判断的练习意图；无法判断时为 null（不要默认 none） */
    practice: PracticeFocus | null;
    unsupported: string[];
    rationale: string;
    error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString<T extends string>(
    value: unknown,
    allowed: readonly T[],
): T | undefined {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? value as T
        : undefined;
}

function pickKey(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return parseKey(value.trim())?.key;
}

function pickNumMeasures(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        return undefined;
    }
    const { min, max } = LOCAL_IMPROV_CONFIG.numMeasures;
    return Math.max(min, Math.min(max, value));
}

function pickTimeSignature(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return LOCAL_IMPROV_CONFIG.timeSignatures.includes(value) ? value : undefined;
}

function pickFretRange(value: unknown): FretRange | undefined {
    if (!isRecord(value)) return undefined;
    const rawMin = value.min;
    const rawMax = value.max;
    if (typeof rawMin !== 'number' || typeof rawMax !== 'number'
        || !Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
        return undefined;
    }
    const clamp = (fret: number): number => Math.max(
        LOCAL_IMPROV_CONFIG.playability.fretMin,
        Math.min(LOCAL_IMPROV_CONFIG.playability.fretMax, Math.round(fret)),
    );
    let min = clamp(rawMin);
    let max = clamp(rawMax);
    if (min > max) [min, max] = [max, min];
    return { min, max };
}

function pickProgression(value: unknown): Progression | undefined {
    if (typeof value !== 'string') return undefined;
    return parseProgressionText(value) ?? undefined;
}

function pickChordsPerMeasure(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return LOCAL_IMPROV_CONFIG.chordsPerMeasure.options.includes(value)
        ? value
        : undefined;
}

function sanitizeOptions(raw: unknown): ImprovBriefOptions {
    if (!isRecord(raw)) return {};
    const source = raw as RawBriefOptions;
    const options: ImprovBriefOptions = {};

    const key = pickKey(source.key);
    if (key !== undefined) options.key = key;
    const scaleType = pickString<ScaleType>(source.scaleType, SCALE_TYPES);
    if (scaleType !== undefined) options.scaleType = scaleType;
    const style = pickString<LocalStyle>(source.style, LOCAL_STYLES);
    if (style !== undefined) options.style = style;
    const density = pickString<LocalDensity>(source.density, LOCAL_DENSITIES);
    if (density !== undefined) options.density = density;
    const numMeasures = pickNumMeasures(source.numMeasures);
    if (numMeasures !== undefined) options.numMeasures = numMeasures;
    const timeSignature = pickTimeSignature(source.timeSignature);
    if (timeSignature !== undefined) options.timeSignature = timeSignature;
    const fingering = pickString<FingeringPattern>(source.fingering, FINGERING_PATTERNS);
    if (fingering !== undefined) options.fingering = fingering;
    const fretRange = pickFretRange(source.fretRange);
    if (fretRange !== undefined) options.fretRange = fretRange;
    const progression = pickProgression(source.progression);
    if (progression !== undefined) options.progression = progression;
    const chordsPerMeasure = pickChordsPerMeasure(source.chordsPerMeasure);
    if (chordsPerMeasure !== undefined) options.chordsPerMeasure = chordsPerMeasure;

    return options;
}

function sanitizeUnsupported(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .map(item => item.slice(0, 200))
        .slice(0, 5);
}

/**
 * 解析 brief 响应。
 *
 * @returns 失败时 `error` 非空，`options` 为空对象；调用方应回落到本地解析。
 */
export function parseImprovBriefResponse(text: string): ImprovBriefParseResult {
    const parsed = extractJsonObject(text);
    if (!isRecord(parsed)) {
        return {
            options: {},
            practice: null,
            unsupported: [],
            rationale: '',
            error: 'AI 响应不是合法 JSON',
        };
    }

    const raw = parsed as RawBrief;
    if (!isRecord(raw.options)) {
        return {
            options: {},
            practice: null,
            unsupported: [],
            rationale: '',
            error: 'AI 返回的 JSON 缺少 options 对象',
        };
    }

    const practice = pickString<PracticeFocus>(raw.practice, PRACTICE_FOCUSES) ?? null;
    const rationale = typeof raw.rationale === 'string'
        ? raw.rationale.trim().slice(0, 300)
        : '';

    return {
        options: sanitizeOptions(raw.options),
        practice,
        unsupported: sanitizeUnsupported(raw.unsupported),
        rationale,
    };
}
