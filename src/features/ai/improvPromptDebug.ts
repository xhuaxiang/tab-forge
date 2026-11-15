/**
 * improvPromptDebug — 两段式 AI 即兴的提示词调试面板。
 *
 * 需求解析：直接编辑 system prompt + 查看按当前面板构造的 user prompt，
 * 测试后展示原始 JSON 与解析结果，不写谱。
 * 表现扩展：先用当前选项生成本地底稿，展示紧凑拍位表；测试后展示
 * 应用/丢弃统计，可由调用方注入的回调决定是否写谱。
 *
 * 本文件不 import `app/dom.ts`；状态与写谱都通过回调由 app 层传入。
 */

import type { Note, TabScore } from '../../core/types/index.ts';
import type {
    HarmonyMeasure,
    ImprovBriefOptions,
    PhrasePlan,
    ResolvedImprovOptions,
} from '../../core/types/improv/index.ts';
import { IMPROV_AI_CONFIG, LOCAL_IMPROV_CONFIG } from '../../core/config.ts';
import {
    applyPerformancePatches,
    parseImprovDescription,
} from '../../core/utils/improv/index.ts';
import { callDeepSeek, getApiKey } from './aiService.ts';
import { parseImprovBriefResponse } from './improvBriefParser.ts';
import { parseImprovPatchesResponse } from './improvPatchParser.ts';
import { getEffectiveBriefPrompt, getEffectivePatchPrompt } from './improvPromptEditor.ts';
import {
    buildBriefUserPrompt,
    buildPatchUserPrompt,
} from './improvService.ts';
import { runImprovPipeline } from './improvPipeline.ts';

export interface ImprovPromptDebugOptions {
    apiKey: string;
    extraPrompt: string;
    base: ImprovBriefOptions;
    score: TabScore;
    /** 注入后显示「写入谱面」按钮；由 app 层实现 store 写入 */
    onWriteScore?: (notes: Note[], options: ResolvedImprovOptions) => void;
    onStatus?: (message: string, kind?: 'info' | 'success' | 'error') => void;
}

/** 读取 API Key（调试面板允许用已保存的 Key，不强制面板有值） */
async function readApiKey(fallback: string): Promise<string> {
    return fallback || (await getApiKey()) || '';
}

export function openImprovPromptDebug(options: ImprovPromptDebugOptions): void {
    void (async () => {
        const [briefSystem, patchSystem, apiKey] = await Promise.all([
            getEffectiveBriefPrompt(),
            getEffectivePatchPrompt(),
            readApiKey(options.apiKey),
        ]);
        buildModal(briefSystem, patchSystem, apiKey, options);
    })();
}

function buildModal(
    briefSystem: string,
    patchSystem: string,
    apiKey: string,
    options: ImprovPromptDebugOptions,
): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:820px; max-height:88vh; overflow:auto;">
            <h3>🧪 AI 即兴 Prompt 调试</h3>
            <p class="modal-hint">调试只发请求、不自动写谱；表现扩展页可手动写入。</p>

            <strong style="font-size:12px;">1. 需求解析（brief）</strong>
            <textarea class="modal-textarea" id="debugBriefSystem" style="min-height:180px;"></textarea>
            <textarea class="modal-textarea" id="debugBriefUser" readonly style="min-height:120px; margin-top:6px; opacity:.85;"></textarea>
            <div class="modal-footer" style="justify-content:flex-start; margin:6px 0;">
                <button id="debugBriefRun" class="btn-copy">测试解析</button>
                <span id="debugBriefState" class="modal-hint"></span>
            </div>
            <pre id="debugBriefResult" style="white-space:pre-wrap; font-size:11px; max-height:200px; overflow:auto;"></pre>

            <hr style="margin:14px 0; opacity:.2;">
            <strong style="font-size:12px;">2. 表现扩展（patch）</strong>
            <textarea class="modal-textarea" id="debugPatchSystem" style="min-height:180px;"></textarea>
            <textarea class="modal-textarea" id="debugPatchUser" readonly style="min-height:160px; margin-top:6px; opacity:.85;"></textarea>
            <div class="modal-footer" style="justify-content:flex-start; margin:6px 0;">
                <button id="debugPatchRun" class="btn-copy">测试扩展</button>
                <button id="debugPatchWrite" class="btn-copy" style="display:none;">写入谱面</button>
                <span id="debugPatchState" class="modal-hint"></span>
            </div>
            <pre id="debugPatchResult" style="white-space:pre-wrap; font-size:11px; max-height:200px; overflow:auto;"></pre>

            <div class="modal-footer">
                <button id="debugCloseBtn">关闭</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const briefSystemArea = modal.querySelector('#debugBriefSystem') as HTMLTextAreaElement;
    const patchSystemArea = modal.querySelector('#debugPatchSystem') as HTMLTextAreaElement;
    const briefUserArea = modal.querySelector('#debugBriefUser') as HTMLTextAreaElement;
    const patchUserArea = modal.querySelector('#debugPatchUser') as HTMLTextAreaElement;
    const briefResult = modal.querySelector('#debugBriefResult') as HTMLElement;
    const patchResult = modal.querySelector('#debugPatchResult') as HTMLElement;
    const briefState = modal.querySelector('#debugBriefState') as HTMLElement;
    const patchState = modal.querySelector('#debugPatchState') as HTMLElement;
    const briefBtn = modal.querySelector('#debugBriefRun') as HTMLButtonElement;
    const patchBtn = modal.querySelector('#debugPatchRun') as HTMLButtonElement;
    const writeBtn = modal.querySelector('#debugPatchWrite') as HTMLButtonElement;

    briefSystemArea.value = briefSystem;
    patchSystemArea.value = patchSystem;

    briefUserArea.value = buildBriefUserPrompt({
        score: options.score,
        base: options.base,
        extraPrompt: options.extraPrompt,
        localParse: parseImprovDescription(options.extraPrompt),
    });

    const close = (): void => {
        document.body.removeChild(modal);
    };
    modal.querySelector('#debugCloseBtn')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });

    // ---- 需求解析 ----
    briefBtn.addEventListener('click', async () => {
        if (!apiKey) {
            briefState.textContent = '未配置 API Key';
            return;
        }
        briefBtn.disabled = true;
        briefState.textContent = '请求中...';
        briefResult.textContent = '';
        try {
            const response = await callDeepSeek({
                system: briefSystemArea.value,
                user: briefUserArea.value,
                apiKey,
                temperature: IMPROV_AI_CONFIG.brief.temperature,
                maxTokens: IMPROV_AI_CONFIG.brief.maxTokens,
            });
            if (response.error) {
                briefState.textContent = response.error;
                return;
            }
            const parsed = parseImprovBriefResponse(response.content);
            briefState.textContent = '完成';
            briefResult.textContent = [
                '## 原始响应',
                response.content,
                '',
                '## 解析结果',
                JSON.stringify(parsed, null, 2),
            ].join('\n');
        } finally {
            briefBtn.disabled = false;
        }
    });

    // ---- 表现扩展（先本地底稿） ----
    let localNotes: Note[] | null = null;
    let localOptions: ResolvedImprovOptions | null = null;
    let localHarmony: HarmonyMeasure[] | null = null;
    let localPhrases: PhrasePlan[] | null = null;
    let localMaxLeap = 0;

    const generateLocal = async (): Promise<boolean> => {
        patchState.textContent = '生成本地底稿...';
        const pipeline = await runImprovPipeline({
            score: options.score,
            base: options.base,
            extraPrompt: options.extraPrompt,
            apiKey: null,
            seed: 1,
        });
        if (pipeline.fatal || !pipeline.local || !pipeline.notes) {
            patchState.textContent = pipeline.error ?? '本地生成失败';
            return false;
        }
        localNotes = pipeline.notes;
        localOptions = pipeline.local.options;
        localHarmony = pipeline.local.harmony;
        localPhrases = pipeline.local.phrases;
        localMaxLeap = pipeline.local.maxLeapSemitones;
        patchUserArea.value = buildPatchUserPrompt({
            score: options.score,
            local: pipeline.local,
            extraPrompt: options.extraPrompt,
        });
        patchState.textContent = '本地底稿已生成';
        return true;
    };

    patchBtn.addEventListener('click', async () => {
        if (!apiKey) {
            patchState.textContent = '未配置 API Key';
            return;
        }
        if (!localNotes || !localOptions || !localHarmony || !localPhrases) {
            const ok = await generateLocal();
            if (!ok) return;
        }
        patchBtn.disabled = true;
        patchState.textContent = '请求中...';
        patchResult.textContent = '';
        // 上一轮的写谱按钮不能留到本轮：闭包里是旧底稿与旧应用结果
        writeBtn.style.display = 'none';
        writeBtn.onclick = null;
        try {
            const response = await callDeepSeek({
                system: patchSystemArea.value,
                user: patchUserArea.value,
                apiKey,
                temperature: IMPROV_AI_CONFIG.patch.temperature,
                maxTokens: IMPROV_AI_CONFIG.patch.maxTokens,
            });
            if (response.error) {
                patchState.textContent = response.error;
                return;
            }
            const parsed = parseImprovPatchesResponse(
                response.content, IMPROV_AI_CONFIG.patch.maxPatches,
            );
            if (parsed.error) {
                patchState.textContent = parsed.error;
                patchResult.textContent = ['## 原始响应', response.content].join('\n');
                return;
            }
            if (!localNotes || !localOptions || !localHarmony || !localPhrases) return;
            const applied = applyPerformancePatches(
                localNotes,
                parsed.patches,
                localOptions,
                LOCAL_IMPROV_CONFIG.playability,
                localHarmony,
                localPhrases,
                localMaxLeap,
                IMPROV_AI_CONFIG.patch.maxPatches,
            );
            patchState.textContent = applied.reverted
                ? '应用后复核失败，已回退底稿'
                : `应用 ${applied.applied} 处，丢弃 ${applied.dropped.length} 条`;
            patchResult.textContent = [
                '## 原始响应',
                response.content,
                '',
                '## 解析警告',
                JSON.stringify(parsed.warnings, null, 2),
                '',
                '## 应用统计',
                JSON.stringify({
                    applied: applied.applied,
                    reverted: applied.reverted,
                    dropped: applied.dropped,
                    finalErrors: applied.finalErrors,
                }, null, 2),
            ].join('\n');

            if (options.onWriteScore && !applied.reverted) {
                writeBtn.style.display = '';
                writeBtn.onclick = (): void => {
                    options.onWriteScore?.(applied.notes, localOptions as ResolvedImprovOptions);
                    options.onStatus?.('调试结果已写入谱面', 'success');
                };
            }
        } finally {
            patchBtn.disabled = false;
        }
    });

    // 打开时先生成一次底稿，方便直接看拍位表
    void generateLocal();
}
