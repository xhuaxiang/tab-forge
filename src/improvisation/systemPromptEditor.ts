/**
 * systemPromptEditor — 系统提示词编辑器（隐藏功能，独立功能文件）
 *
 * 在 AI 即兴面板的「额外要求」里输入「修改系统对话」触发：
 * 弹出一个居中弹窗，textarea 预填当前生效的 SYSTEM_PROMPT，可编辑；
 * 确认后按 api-key 那套逻辑（chrome.storage.local / localStorage）存到本地，
 * 之后生成即兴时使用自定义 system prompt（未设置则用默认）。
 *
 * 不侵入 promptBuilder.ts；纯逻辑（触发判断/存储/取生效值）与 UI（弹窗）都在本文件。
 */

import { SYSTEM_PROMPT } from './promptBuilder.ts';
import { setStatus } from '../app/state.ts';

/** 触发隐藏功能的额外要求文案 */
export const TRIGGER_EXTRA_PROMPT = '修改系统对话';

/** 本地存储键（与 api-key 同一套 chrome.storage/localStorage 逻辑） */
const STORAGE_KEY = 'TabForge_CustomSystemPrompt';

/** 检测是否在 Chrome Extension 环境 */
function isChromeExtension(): boolean {
    return typeof chrome !== 'undefined' && !!chrome.storage;
}

/** 是否命中隐藏功能触发词（extraPrompt 精确等于「修改系统对话」） */
export function isSystemPromptTrigger(extraPrompt?: string): boolean {
    return extraPrompt?.trim() === TRIGGER_EXTRA_PROMPT;
}

/** 读取自定义 system prompt（未设置返回 null） */
export async function getCustomSystemPrompt(): Promise<string | null> {
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

/** 保存自定义 system prompt */
export async function saveCustomSystemPrompt(prompt: string): Promise<void> {
    if (isChromeExtension()) {
        await chrome.storage.local.set({ [STORAGE_KEY]: prompt });
        return;
    }
    try {
        localStorage.setItem(STORAGE_KEY, prompt);
    } catch { /* ignore */ }
}

/** 当前生效的 system prompt：自定义优先，未设置用默认 */
export async function getEffectiveSystemPrompt(): Promise<string> {
    const custom = await getCustomSystemPrompt();
    return custom && custom.trim() ? custom : SYSTEM_PROMPT;
}

/** 打开居中弹窗编辑系统提示词，确认后保存并关闭 */
export function openSystemPromptEditor(): void {
    void (async () => {
        const current = await getEffectiveSystemPrompt();
        buildModal(current);
    })();
}

/** 构建居中弹窗（复用导出弹窗的 modal 样式） */
function buildModal(initial: string): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>✏️ 修改系统提示词</h3>
            <p class="modal-hint">编辑 AI 即兴生成的系统提示词（system prompt），保存后对后续生成生效。</p>
            <textarea class="modal-textarea" id="systemPromptTextarea" style="min-height:280px;"></textarea>
            <div class="modal-footer">
                <button id="systemPromptCancelBtn">取消</button>
                <button id="systemPromptSaveBtn" class="btn-copy">保存</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const textarea = modal.querySelector('#systemPromptTextarea') as HTMLTextAreaElement;
    textarea.value = initial; // 程序赋值，避免 HTML 转义问题
    const close = (): void => {
        document.body.removeChild(modal);
    };

    modal.querySelector('#systemPromptCancelBtn')?.addEventListener('click', close);
    modal.querySelector('#systemPromptSaveBtn')?.addEventListener('click', async () => {
        await saveCustomSystemPrompt(textarea.value);
        close();
        setStatus('系统提示词已保存，对后续生成生效', 'success');
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    textarea.focus();
}
