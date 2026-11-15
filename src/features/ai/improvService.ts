/**
 * improvService — 「本地底稿 + AI 扩展」两段请求。
 *
 * brief：把用户的额外要求结构化成生成选项；
 * patch：在已合法的本地底稿上产出表现层补丁。
 *
 * 两者都走 `callDeepSeek`，失败只返回 `error`，不抛异常；调用方据此降级，
 * 本地底稿永远不依赖 AI 成功。
 */

import type { TabScore } from '../../core/types/index.ts';
import type {
    ImprovBriefOptions,
    LocalImprovResult,
    PerformancePatch,
} from '../../core/types/improv/index.ts';
import { IMPROV_AI_CONFIG } from '../../core/config.ts';
import { formatChordSpec, serializeImprovSlots } from '../../core/utils/improv/index.ts';
import { callDeepSeek } from './aiService.ts';
import { parseImprovBriefResponse } from './improvBriefParser.ts';
import type { ImprovBriefParseResult } from './improvBriefParser.ts';
import { parseImprovPatchesResponse } from './improvPatchParser.ts';
import { getEffectiveBriefPrompt, getEffectivePatchPrompt } from './improvPromptEditor.ts';

export interface ImprovBriefResult extends ImprovBriefParseResult {
    /** AI 原始响应（调试面板展示用） */
    raw: string;
}

export interface ImprovPatchResult {
    patches: PerformancePatch[];
    warnings: string[];
    /** AI 原始响应（调试面板展示用） */
    raw: string;
    error?: string;
}

export interface ImprovBriefRequest {
    score: TabScore;
    /** 面板选项（用户明确选择的） */
    base: ImprovBriefOptions;
    extraPrompt: string;
    /** 本地关键词解析结果，仅供 AI 参考 */
    localParse: ImprovBriefOptions;
    apiKey: string;
}

export interface ImprovPatchRequest {
    score: TabScore;
    local: LocalImprovResult;
    extraPrompt: string;
    apiKey: string;
}

function optionLine(label: string, value: unknown): string {
    const shown = value === undefined || value === null || value === ''
        ? '未指定'
        : String(value);
    return `- ${label}：${shown}`;
}

function summaryLine(label: string, value: unknown): string {
    return `- ${label}：${value === undefined || value === '' ? '未指定' : String(value)}`;
}

/** 拼 brief 的 user prompt（调试面板同源） */
export function buildBriefUserPrompt(input: Omit<ImprovBriefRequest, 'apiKey'>): string {
    const { score, base, localParse, extraPrompt } = input;
    const localText = Object.keys(localParse).length > 0
        ? JSON.stringify(localParse, null, 2)
        : '（无）';

    return [
        '## 当前乐谱',
        summaryLine('调性', score.key),
        summaryLine('拍号', score.timeSignature),
        summaryLine('小节数', score.measures.length),
        '',
        '## 面板选项（用户已选，可被额外要求覆盖）',
        optionLine('小节数', base.numMeasures),
        optionLine('调性', base.key),
        optionLine('音阶', base.scaleType),
        optionLine('风格', base.style),
        optionLine('密度', base.density),
        optionLine('拍号', base.timeSignature),
        '',
        '## 本地关键词解析结果（已确定性识别，仅供对照）',
        localText,
        '',
        '## 用户额外要求（优先级最高）',
        extraPrompt.trim() || '（无）',
        '',
        '请按要求输出 JSON。',
    ].join('\n');
}

/** 拼 patch 的 user prompt（调试面板同源） */
export function buildPatchUserPrompt(input: Omit<ImprovPatchRequest, 'apiKey'>): string {
    const { local, extraPrompt } = input;
    const { options } = local;
    const fretLabel = options.fretRange
        ? `${options.fretRange.min}-${options.fretRange.max} 品（来源：${options.fretRangeSource}）`
        : '风格把位';
    const chords = local.harmony.map(measure => (
        measure.segments.map(segment => formatChordSpec(segment.chord)).join('/')
    ));
    const chordLines = chords.length > 0
        ? chords.map((chord, index) => `- 第 ${index + 1} 小节：${chord || '—'}`).join('\n')
        : '- （无和声信息）';
    const slots = serializeImprovSlots(local.notes, options);

    return [
        '## 本地底稿',
        summaryLine('调性', options.key),
        summaryLine('音阶', options.scaleType),
        summaryLine('风格', options.style),
        summaryLine('练习意图', options.practice),
        summaryLine('把位', fretLabel),
        summaryLine('拍号', options.timeSignature),
        summaryLine('小节数', options.numMeasures),
        '',
        '## 每小节和弦',
        chordLines,
        '',
        '## 拍位表（JSON；休止也占 slotIndex）',
        JSON.stringify(slots, null, 1),
        '',
        '## 用户额外要求',
        extraPrompt.trim() || '（无）',
        '',
        `最多返回 ${IMPROV_AI_CONFIG.patch.maxPatches} 条补丁。请输出 JSON。`,
    ].join('\n');
}

/** 请求需求解析（brief）；失败只返回 error */
export async function requestImprovBrief(input: ImprovBriefRequest): Promise<ImprovBriefResult> {
    const system = await getEffectiveBriefPrompt();
    const user = buildBriefUserPrompt(input);
    const response = await callDeepSeek({
        system,
        user,
        apiKey: input.apiKey,
        temperature: IMPROV_AI_CONFIG.brief.temperature,
        maxTokens: IMPROV_AI_CONFIG.brief.maxTokens,
    });

    if (response.error) {
        return {
            options: {},
            practice: null,
            unsupported: [],
            rationale: '',
            raw: '',
            error: response.error,
        };
    }

    return {
        ...parseImprovBriefResponse(response.content),
        raw: response.content,
    };
}

/** 请求表现扩展（patch）；失败只返回 error */
export async function requestImprovPatches(input: ImprovPatchRequest): Promise<ImprovPatchResult> {
    const system = await getEffectivePatchPrompt();
    const user = buildPatchUserPrompt(input);
    const response = await callDeepSeek({
        system,
        user,
        apiKey: input.apiKey,
        temperature: IMPROV_AI_CONFIG.patch.temperature,
        maxTokens: IMPROV_AI_CONFIG.patch.maxTokens,
    });

    if (response.error) {
        return {
            patches: [],
            warnings: [],
            raw: '',
            error: response.error,
        };
    }

    return {
        ...parseImprovPatchesResponse(
            response.content,
            IMPROV_AI_CONFIG.patch.maxPatches,
        ),
        raw: response.content,
    };
}
