/**
 * improvPipeline — 「本地底稿 + AI 表现扩展」的两阶段编排。
 *
 * 顺序固定：本地关键词解析 →（可选）AI brief → 合并选项 → 本地生成
 * （窄把位 / 和声不可用时逐级放宽）→（可选）AI patch → 逐条校验后应用。
 *
 * 关键原则：本地底稿永远先产出。AI 的任何失败只能降级为「没有 AI 扩展」，
 * 不能导致没有谱。本文件不碰 DOM；网络请求由 `improvService` 负责，
 * 测试可经 `deps` 注入假实现。
 */

import type { Note, TabScore } from '../../core/types/index.ts';
import type {
    ImprovBriefOptions,
    ImprovOptions,
    LocalImprovResult,
} from '../../core/types/improv/index.ts';
import { IMPROV_AI_CONFIG, LOCAL_IMPROV_CONFIG } from '../../core/config.ts';
import { t } from '../../core/i18n/index.ts';
import {
    buildChordChart,
    chordChartFromBars,
    generateLocalImprovisation,
    mergeImprovOptions,
    parseDescriptionChordChart,
    parseImprovDescription,
    resolveLocalImprovOptions,
    applyPerformancePatches,
    type PatchApplyResult,
} from '../../core/utils/improv/index.ts';
import type { ImprovBriefResult, ImprovPatchResult } from './improvService.ts';
import { requestImprovBrief, requestImprovPatches } from './improvService.ts';

export interface ImprovPipelineDeps {
    requestBrief?: (input: Parameters<typeof requestImprovBrief>[0]) => Promise<ImprovBriefResult>;
    requestPatches?: (input: Parameters<typeof requestImprovPatches>[0]) => Promise<ImprovPatchResult>;
    generate?: (input: Partial<ImprovOptions>) => LocalImprovResult;
}

export interface ImprovPipelineInput {
    score: TabScore;
    /** 面板选项 */
    base: ImprovBriefOptions;
    extraPrompt: string;
    apiKey: string | null;
    seed?: number;
    /** 测试注入；缺省时用 `parseImprovDescription(extraPrompt)` */
    localParse?: Partial<ImprovOptions>;
    deps?: ImprovPipelineDeps;
}

export interface ImprovPipelineResult {
    /** base < AI < local 合并后的选项 */
    merged: ImprovBriefOptions;
    local: LocalImprovResult | null;
    /** patch 应用统计；没跑 patch 或 patch 失败时为 null */
    apply: PatchApplyResult | null;
    brief: ImprovBriefResult | null;
    patch: ImprovPatchResult | null;
    /** 最终要写谱的音符；本地失败时为 null */
    notes: Note[] | null;
    /** 降级 / 冲突提示（按发生顺序） */
    messages: string[];
    /** 本地生成最终失败时的错误原文 */
    error?: string;
    /** true = 没有可写谱的底稿 */
    fatal: boolean;
}

interface GenerationOutcome {
    result?: LocalImprovResult;
    error?: string;
}

function attemptGenerate(
    generate: NonNullable<ImprovPipelineDeps['generate']>,
    input: Partial<ImprovOptions>,
): GenerationOutcome {
    try {
        return { result: generate(input) };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/** 本地明确写出的字段被 AI 覆盖时给出提示（只报值确实不同的键） */
function collectConflicts(
    ai: ImprovBriefOptions,
    local: ImprovBriefOptions,
): string[] {
    const messages: string[] = [];
    for (const key of Object.keys(local) as (keyof ImprovBriefOptions)[]) {
        if (ai[key] === undefined) continue;
        if (JSON.stringify(ai[key]) !== JSON.stringify(local[key])) {
            messages.push(t('ai.pipeline.conflict', { key }));
        }
    }
    return messages;
}

/**
 * 把位来源：用户显式 / AI 建议 / 由指型或风格推导。
 *
 * AI 编出来的把位不是硬约束，生成失败时可丢弃重试；只有 base 或本地
 * 描述里明确写出的范围才不允许降级。
 */
type FretRangeProvenance = 'explicit' | 'ai' | 'derived';

interface GenerationBuild {
    generation: Partial<ImprovOptions>;
    fretRangeProvenance: FretRangeProvenance;
    /** progression / chordChart 是否全部来自 AI（本地未明确写和声） */
    progressionFromAI: boolean;
}

/** 用合并后的选项搭生成输入（和弦展开与 localImprovForm 同一套纯函数） */
function buildGenerationInput(
    input: ImprovPipelineInput,
    merged: ImprovBriefOptions,
    practice: ImprovOptions['practice'],
    localParse: Partial<ImprovOptions>,
): GenerationBuild {
    const scoreTimeSignature = LOCAL_IMPROV_CONFIG.timeSignatures.includes(
        input.score.timeSignature,
    )
        ? input.score.timeSignature
        : undefined;

    // 本地明确写出的把位优先；本地指型其次（AI 范围不能压过它）
    const localFretRange = localParse.fretRange ?? input.base.fretRange;
    const localFingering = localParse.fingering ?? input.base.fingering;
    let fretRange = merged.fretRange;
    let fretRangeProvenance: FretRangeProvenance = 'derived';
    if (localFretRange !== undefined) {
        fretRange = localFretRange;
        fretRangeProvenance = 'explicit';
    } else if (localFingering !== undefined) {
        fretRange = undefined;
    } else if (merged.fretRange !== undefined) {
        fretRangeProvenance = 'ai';
    }

    // 本地明确写出的进行优先；AI 只补本地没有的
    const localProgression = localParse.progression ?? input.base.progression;
    const progression = localProgression ?? merged.progression;

    const generation: Partial<ImprovOptions> = {
        numMeasures: merged.numMeasures,
        key: merged.key ?? input.score.key,
        scaleType: merged.scaleType,
        style: merged.style,
        density: merged.density,
        timeSignature: merged.timeSignature ?? scoreTimeSignature,
        tuning: { ...input.score.tuning },
        progression,
        fretRange,
        fingering: merged.fingering,
        practice,
        seed: input.seed,
    };

    // 拍号/小节数可能来自默认值；展开和弦前先解析一次，避免用错容量
    const resolved = resolveLocalImprovOptions(generation);
    const bars = parseDescriptionChordChart(input.extraPrompt);
    if (bars) {
        generation.chordChart = chordChartFromBars(
            bars, resolved.numMeasures, resolved.timeSignature,
        );
    } else if (merged.chordsPerMeasure !== undefined && merged.chordsPerMeasure > 1) {
        generation.chordChart = buildChordChart(
            progression ?? resolved.progression,
            resolved.numMeasures,
            merged.chordsPerMeasure,
            resolved.timeSignature,
        );
    }

    const progressionFromAI = localProgression === undefined
        && bars === null
        && merged.progression !== undefined;

    return { generation, fretRangeProvenance, progressionFromAI };
}

/** 解析把位来源；输入非法时按风格处理，交给生成器报错 */
function resolveRangeSource(input: Partial<ImprovOptions>): string {
    try {
        return resolveLocalImprovOptions(input).fretRangeSource;
    } catch {
        return 'style';
    }
}

/**
 * 跑完整流程。
 *
 * @returns 本地失败时 `fatal: true`、`notes: null`；其余情况一定带底稿。
 */
export async function runImprovPipeline(
    input: ImprovPipelineInput,
): Promise<ImprovPipelineResult> {
    const messages: string[] = [];
    const localParse = input.localParse ?? parseImprovDescription(input.extraPrompt);
    const deps = input.deps ?? {};
    const requestBrief = deps.requestBrief ?? requestImprovBrief;
    const requestPatches = deps.requestPatches ?? requestImprovPatches;
    const generate = deps.generate ?? generateLocalImprovisation;

    let brief: ImprovBriefResult | null = null;
    const hasExtra = input.extraPrompt.trim() !== '';
    if (input.apiKey && hasExtra) {
        try {
            brief = await requestBrief({
                score: input.score,
                base: input.base,
                extraPrompt: input.extraPrompt,
                localParse,
                apiKey: input.apiKey,
            });
        } catch (error) {
            messages.push(t('ai.pipeline.briefFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
            brief = null;
        }
        if (brief?.error) {
            messages.push(t('ai.pipeline.briefFailed', { message: brief.error }));
            brief = null;
        }
    } else if (!input.apiKey) {
        messages.push(t('ai.pipeline.noApiKey'));
    }

    const merged = mergeImprovOptions(
        input.base,
        brief?.options ?? {},
        localParse,
    );
    if (brief) messages.push(...collectConflicts(brief.options, localParse));

    const practice = localParse.practice ?? brief?.practice ?? undefined;
    const built = buildGenerationInput(input, merged, practice, localParse);
    let generation = built.generation;
    let rangeProvenance: FretRangeProvenance = built.fretRangeProvenance;
    const requestedFingering = generation.fingering;

    if (rangeProvenance === 'derived'
        && merged.fretRange !== undefined
        && (localParse.fingering ?? input.base.fingering) !== undefined) {
        messages.push(t('ai.pipeline.fretConflict'));
    }

    let source = resolveRangeSource(generation);
    let outcome = attemptGenerate(generate, generation);

    // 降级文案带上生成器原文：失败不一定是「窗口过窄」，别让用户按错误方向调参

    // AI 给的把位不是硬约束：先丢它，再轮到指型/练习窗口
    if (!outcome.result && rangeProvenance === 'ai') {
        messages.push(t('ai.pipeline.fretUnavailable', {
            message: outcome.error ?? t('ai.pipeline.generationFailed'),
        }));
        generation = { ...generation, fretRange: undefined };
        rangeProvenance = 'derived';
        source = resolveRangeSource(generation);
        outcome = attemptGenerate(generate, generation);
    }

    if (!outcome.result && rangeProvenance !== 'explicit'
        && (source === 'fingering' || source === 'practice')) {
        messages.push(t('ai.pipeline.windowUnavailable', {
            message: outcome.error ?? t('ai.pipeline.generationFailed'),
        }));
        generation = {
            ...generation,
            fingering: undefined,
            fretRange: undefined,
            practice: 'none',
        };
        source = resolveRangeSource(generation);
        outcome = attemptGenerate(generate, generation);
    }

    // AI 补的和声不是硬约束；显式把位只锁把位，不锁和声
    if (!outcome.result
        && (rangeProvenance !== 'explicit' || built.progressionFromAI)
        && (generation.progression !== undefined || generation.chordChart !== undefined)) {
        messages.push(t(
            built.progressionFromAI
                ? 'ai.pipeline.progressionAiUnavailable'
                : 'ai.pipeline.progressionUnavailable',
            { message: outcome.error ?? t('ai.pipeline.generationFailed') },
        ));
        generation = {
            ...generation,
            progression: undefined,
            chordChart: undefined,
        };
        outcome = attemptGenerate(generate, generation);
    }

    if (!outcome.result) {
        if (rangeProvenance === 'explicit') {
            // 尊重用户显式把位：不降级，直接报错
            messages.push(t('ai.pipeline.explicitRangeFailed'));
        }
        return {
            merged,
            local: null,
            apply: null,
            brief,
            patch: null,
            notes: null,
            messages,
            error: outcome.error ?? t('ai.pipeline.localFailed'),
            fatal: true,
        };
    }

    const local = outcome.result;

    // 指型换算不出可演奏把位时不能静默：摘要与状态栏都要说明实际用了什么
    if (requestedFingering !== undefined
        && built.fretRangeProvenance === 'derived'
        && local.options.fretRangeSource !== 'fingering') {
        messages.push(t(
            local.options.fretRangeSource === 'practice'
                ? 'ai.pipeline.fingeringFallbackPractice'
                : 'ai.pipeline.fingeringFallbackStyle',
            { fingering: requestedFingering },
        ));
    }

    let notes: Note[] = local.notes;
    let apply: PatchApplyResult | null = null;
    let patch: ImprovPatchResult | null = null;

    if (input.apiKey) {
        try {
            patch = await requestPatches({
                score: input.score,
                local,
                extraPrompt: input.extraPrompt,
                apiKey: input.apiKey,
            });
        } catch (error) {
            messages.push(t('ai.pipeline.patchFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
            patch = null;
        }
        if (patch?.error) {
            messages.push(t('ai.pipeline.patchFailed', { message: patch.error }));
        }
        if (patch && patch.warnings.length > 0) {
            const shown = patch.warnings.slice(0, 3).join(t('ai.pipeline.warningSeparator'));
            const more = patch.warnings.length > 3
                ? t('ai.pipeline.patchMore', { count: patch.warnings.length })
                : '';
            messages.push(t('ai.pipeline.patchWarnings', { shown, more }));
        }
        if (!patch?.error && patch && patch.patches.length > 0) {
            apply = applyPerformancePatches(
                local.notes,
                patch.patches,
                local.options,
                LOCAL_IMPROV_CONFIG.playability,
                local.harmony,
                local.phrases,
                local.maxLeapSemitones,
                IMPROV_AI_CONFIG.patch.maxPatches,
            );
            notes = apply.notes;
            if (apply.reverted) {
                messages.push(t('ai.pipeline.patchRejected'));
            } else if (apply.dropped.length > 0) {
                messages.push(t('ai.pipeline.patchDropped', {
                    count: apply.dropped.length,
                    reason: apply.dropped[0].reason,
                }));
            }
        }
    }

    return {
        merged,
        local,
        apply,
        brief,
        patch,
        notes,
        messages,
        fatal: false,
    };
}
