/**
 * aiService — DeepSeek API 调用封装
 *
 * 同时支持 Chrome Extension（通过 chrome.storage）和普通浏览器（localStorage）。
 * DeepSeek API 兼容 OpenAI 格式，endpoint 为 https://api.deepseek.com/v1/chat/completions
 */

import type { Note } from '../types/index.ts';
import { buildUserPrompt, type GenerationOptions } from './promptBuilder.ts';
import { parseAIResponse } from './responseParser.ts';
import { getEffectiveSystemPrompt } from './systemPromptEditor.ts';
import type { TabScore } from '../types/index.ts';

// ---- 配置 ----
export const DEEPSEEK_CONFIG = {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-v4-flash',
    temperature: 0.8,
    maxTokens: 4096,
};

// ---- API Key 存储（兼容 extension + web）----
const STORAGE_KEY = 'TabForge_DeepSeekApiKey';

/** 检测是否在 Chrome Extension 环境 */
function isChromeExtension(): boolean {
    return typeof chrome !== 'undefined' && !!chrome.storage;
}

/** 从 chrome.storage.local 或 localStorage 读取 API Key */
export async function getApiKey(): Promise<string | null> {
    if (isChromeExtension()) {
        try {
            const result = await chrome.storage.local.get<Record<typeof STORAGE_KEY, string>>(STORAGE_KEY);
            return result[STORAGE_KEY] || null;
        } catch {
            return null;
        }
    }
    // web fallback: localStorage
    try {
        return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
        return null;
    }
}

/** 保存 API Key */
export async function saveApiKey(key: string): Promise<void> {
    if (isChromeExtension()) {
        await chrome.storage.local.set({ [STORAGE_KEY]: key });
        return;
    }
    try {
        localStorage.setItem(STORAGE_KEY, key);
    } catch { /* ignore */ }
}

// ---- 核心调用 ----

export interface AIGenerationResult {
    notes: Note[];
    error?: string;
}

/**
 * 调用 DeepSeek API 生成即兴谱
 *
 * @param score    当前乐谱上下文
 * @param options  生成选项
 * @param apiKey   DeepSeek API Key
 */
export async function generateImprovisation(
    score: TabScore,
    options: GenerationOptions,
    apiKey: string,
): Promise<AIGenerationResult> {
    const userPrompt = buildUserPrompt(score, options);
    // 生效的 system prompt：自定义（隐藏功能「修改系统对话」保存）优先，否则默认
    const systemPrompt = await getEffectiveSystemPrompt();

    try {
        const response = await fetch(DEEPSEEK_CONFIG.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: DEEPSEEK_CONFIG.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: DEEPSEEK_CONFIG.temperature,
                max_tokens: DEEPSEEK_CONFIG.maxTokens,
                response_format: { type: 'json_object' },
                // V4 默认开启思考模式：即兴这种 prompt 会长时间思考导致"超时"，
                // 且思考可能耗尽 max_tokens 返回空 content（报"未返回内容"）。这里显式关闭。
                thinking: { type: 'disabled' },
            }),
            // 兜底超时：避免无限挂起，超时给出明确错误
            signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            let errMsg = `API 请求失败 (HTTP ${response.status})`;
            try {
                const errJson = JSON.parse(errBody);
                if (errJson.error?.message) {
                    errMsg = errJson.error.message;
                }
            } catch { /* keep default */ }
            return { notes: [], error: errMsg };
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;

        if (!content) {
            return { notes: [], error: 'AI 未返回内容' };
        }

        const result = parseAIResponse(content);
        return result;
    } catch (e) {
        if (e instanceof Error && e.name === 'TimeoutError') {
            return { notes: [], error: '请求超时（60 秒），请检查网络后重试' };
        }
        const msg = e instanceof Error ? e.message : '网络错误';
        return { notes: [], error: `请求失败: ${msg}` };
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
        return { notes: [], error: '此功能仅在 Chrome 扩展中可用' };
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
                resolve(response?.result ?? { notes: [], error: '无响应' });
            },
        );
    });
}