/**
 * aiService — DeepSeek API 调用封装
 *
 * 同时支持 Chrome Extension（通过 chrome.storage）和普通浏览器（localStorage）。
 * DeepSeek API 兼容 OpenAI 格式，endpoint 为 https://api.deepseek.com/v1/chat/completions
 */

import type { Note } from '../../core/types/index.ts';
import { buildUserPrompt, type GenerationOptions } from './promptBuilder.ts';
import { parseAIResponse } from './responseParser.ts';
import { getEffectiveSystemPrompt } from './systemPromptEditor.ts';
import type { TabScore } from '../../core/types/index.ts';
import { DEEPSEEK_CONFIG, AI_TIMEOUT_MS } from '../../core/config.ts';
import { t } from '../../core/i18n/index.ts';
import { readStorage, writeStorage } from '../storage.ts';

// ---- API Key 存储（兼容 extension + web）----
const STORAGE_KEY = 'TabForge_DeepSeekApiKey';

/** background 消息通道只在扩展环境存在（存储读写走 features/storage） */
function isChromeExtension(): boolean {
    return typeof chrome !== 'undefined' && !!chrome.storage;
}

/** 读取 API Key */
export async function getApiKey(): Promise<string | null> {
    return readStorage(STORAGE_KEY);
}

/** 保存 API Key */
export async function saveApiKey(key: string): Promise<void> {
    await writeStorage(STORAGE_KEY, key);
}

// ---- 核心调用 ----

export interface AIGenerationResult {
    notes: Note[];
    error?: string;
}

/** 一次 DeepSeek Chat Completions 调用的入参 */
export interface DeepSeekCallInput {
    system: string;
    user: string;
    apiKey: string;
    temperature: number;
    maxTokens: number;
}

export interface DeepSeekCallResult {
    /** AI 返回的原始 content；失败时为空字符串 */
    content: string;
    error?: string;
}

/**
 * 统一的 DeepSeek 调用（旧「从零生成」与新的 brief / patch 两段共用）。
 *
 * 错误统一翻译成可读文本，不抛异常；调用方按 `content` / `error` 分支。
 */
export async function callDeepSeek(input: DeepSeekCallInput): Promise<DeepSeekCallResult> {
    try {
        const response = await fetch(DEEPSEEK_CONFIG.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${input.apiKey}`,
            },
            body: JSON.stringify({
                model: DEEPSEEK_CONFIG.model,
                messages: [
                    { role: 'system', content: input.system },
                    { role: 'user', content: input.user },
                ],
                temperature: input.temperature,
                max_tokens: input.maxTokens,
                response_format: { type: 'json_object' },
                // V4 默认开启思考模式：即兴这种 prompt 会长时间思考导致"超时"，
                // 且思考可能耗尽 max_tokens 返回空 content（报"未返回内容"）。这里显式关闭。
                thinking: { type: 'disabled' },
            }),
            // 兜底超时：避免无限挂起，超时给出明确错误
            signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        });

        if (!response.ok) {
            return { content: '', error: await describeApiError(response) };
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) return { content: '', error: t('ai.error.emptyResponse') };
        return { content };
    } catch (e) {
        if (e instanceof Error && e.name === 'TimeoutError') {
            return { content: '', error: t('ai.error.timeout') };
        }
        const msg = e instanceof Error ? e.message : t('ai.error.network');
        return { content: '', error: t('ai.error.requestFailed', { message: msg }) };
    }
}

/**
 * 调用 DeepSeek API 生成即兴谱
 *
 * @param _score   当前乐谱上下文（暂未使用：调试期 user prompt 最小化，score 上下文注入临时移除；保留参数以兼容调用方与后台消息协议）
 * @param options  生成选项
 * @param apiKey   DeepSeek API Key
 */
export async function generateImprovisation(
    _score: TabScore,
    options: GenerationOptions,
    apiKey: string,
): Promise<AIGenerationResult> {
    const userPrompt = buildUserPrompt(options);
    // 生效的 system prompt：自定义（隐藏功能「修改系统对话」保存）优先，否则默认
    const systemPrompt = await getEffectiveSystemPrompt();

    const response = await callDeepSeek({
        system: systemPrompt,
        user: userPrompt,
        apiKey,
        temperature: DEEPSEEK_CONFIG.temperature,
        maxTokens: DEEPSEEK_CONFIG.maxTokens,
    });
    if (response.error) return { notes: [], error: response.error };

    return parseAIResponse(response.content);
}

// ---- Prompt 调试：用显式 system/user prompt 直接调用（供 promptDebug 面板）----

export interface DebugGenerateResult {
    /** AI 原始 content（未解析） */
    raw: string;
    /** 解析出的音符 */
    notes: Note[];
    error?: string;
}

/**
 * 用指定的 system/user prompt 直接调用 DeepSeek，返回原始响应 + 解析结果。
 * 与 generateImprovisation 的唯一区别：prompt 由调用方显式给出（绕过默认读取），供调试面板使用。
 */
export async function debugGenerate(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
): Promise<DebugGenerateResult> {
    const response = await callDeepSeek({
        system: systemPrompt,
        user: userPrompt,
        apiKey,
        temperature: DEEPSEEK_CONFIG.temperature,
        maxTokens: DEEPSEEK_CONFIG.maxTokens,
    });
    if (response.error) return { raw: '', notes: [], error: response.error };

    const parsed = parseAIResponse(response.content);
    return { raw: response.content, notes: parsed.notes, error: parsed.error };
}

/**
 * 把 API 的错误响应翻译成能定位问题的信息（两处调用点共用，别各写一份）。
 *
 * ⚠️ 必须保留 HTTP 状态码：DeepSeek 的 `error.message` 有时只是它服务端的一句
 * 内部报错（例如「[API] An unexpected error occurred TypeError: Cannot read
 * properties of null」），把状态码丢掉就分不清是 4xx（我们的请求不合法：
 * 模型名 / 参数 / 额度）还是 5xx（对方故障，重试即可）。
 * 原文同时打到 console，方便进一步排查。
 */
async function describeApiError(response: Response): Promise<string> {
    const body = await response.text().catch(() => '');
    console.error(`[TabForge] DeepSeek API ${response.status} 原文:`, body);
    const head = t('ai.error.httpFailed', { status: response.status });
    try {
        const json = JSON.parse(body);
        const detail = [json?.error?.message, json?.error?.type, json?.error?.code]
            .filter(Boolean)
            .join(' / ');
        return detail ? `${head}: ${detail}` : head;
    } catch {
        // 非 JSON 响应：截一段原文，够定位就行
        return body ? `${head}: ${body.slice(0, 300)}` : head;
    }
}

/**
 * 通过 background service worker 调用（仅 Extension 环境可用）
 */
export async function generateViaBackground(
    score: TabScore,
    options: GenerationOptions,
): Promise<AIGenerationResult> {
    if (!isChromeExtension()) {
        return { notes: [], error: t('ai.error.extensionOnly') };
    }
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            {
                action: 'generateImprovisation',
                score,
                options,
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ notes: [], error: chrome.runtime.lastError.message });
                    return;
                }
                resolve(response?.result ?? { notes: [], error: t('ai.error.noResponse') });
            },
        );
    });
}