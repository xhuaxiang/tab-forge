/**
 * systemPromptEditor — 系统提示词编辑器（隐藏功能，独立功能文件）
 *
 * 在 AI 即兴面板的「额外要求」里输入「修改系统对话」触发：
 * 弹出一个居中弹窗，textarea 预填当前生效的「专业性描述」，可编辑；
 * 确认后按 api-key 那套逻辑（chrome.storage.local / localStorage）存到本地，
 * 之后生成即兴时使用它（未设置则用默认）。
 *
 * 存的是专业性描述，不含数据结构 —— 数据结构由 composeSystemPrompt 在发请求前恒定追加，
 * 不展示、不可编辑，避免契约被改坏导致解析静默失败。
 *
 * 不侵入 promptBuilder.ts；纯逻辑（触发判断/存储/取生效值）与 UI（弹窗）都在本文件。
 */

import { composeSystemPrompt, stripContract, DEFAULT_EXPERT_PROMPT } from './promptBuilder.ts';
import { t } from '../../core/i18n/index.ts';
import { readStorage, writeStorage } from '../storage.ts';
import { setStatus } from '../../app/dom.ts';
import { TRIGGER_EXTRA_PROMPT, isSystemPromptTrigger } from './promptTriggers.ts';

export { TRIGGER_EXTRA_PROMPT, isSystemPromptTrigger };

/** 本地存储键（与 api-key 同一套 chrome.storage/localStorage 逻辑） */
const STORAGE_KEY = 'TabForge_CustomSystemPrompt';

/** 读取本地存的专业性描述原文（未设置返回 null） */
async function readStoredPrompt(): Promise<string | null> {
    return readStorage(STORAGE_KEY);
}

/**
 * 读取自定义专业性描述（未设置返回 null）。
 * 旧版存的是「专业性描述 + 数据结构」整段，这里剥掉数据结构块，与当前格式统一。
 */
export async function getCustomSystemPrompt(): Promise<string | null> {
    const raw = await readStoredPrompt();
    return raw ? stripContract(raw) : null;
}

/** 保存自定义专业性描述（不含数据结构） */
export async function saveCustomSystemPrompt(prompt: string): Promise<void> {
    await writeStorage(STORAGE_KEY, prompt);
}

/** 当前生效的可编辑部分（专业性描述，不含数据结构）：自定义优先，未设置用默认 */
export async function getEditableSystemPrompt(): Promise<string> {
    const custom = await getCustomSystemPrompt();
    return custom && custom.trim() ? custom : DEFAULT_EXPERT_PROMPT;
}

/**
 * 当前生效的完整 system prompt（专业性描述 + 代码追加的数据结构），发请求用。
 * 编辑器/调试面板只经手可编辑部分，别用这个去预填输入框。
 */
export async function getEffectiveSystemPrompt(): Promise<string> {
    return composeSystemPrompt(await getEditableSystemPrompt());
}

/** 打开居中弹窗编辑专业性描述，确认后保存并关闭 */
export function openSystemPromptEditor(): void {
    void (async () => {
        buildModal(await getEditableSystemPrompt());
    })();
}

/** 构建居中弹窗（复用导出弹窗的 modal 样式） */
function buildModal(initial: string): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>${t('ai.editor.systemTitle')}</h3>
            <p class="modal-hint">${t('ai.editor.systemHint')}</p>
            <textarea class="modal-textarea" id="systemPromptTextarea" style="min-height:280px;"></textarea>
            <div class="modal-footer">
                <button id="systemPromptCancelBtn">${t('common.cancelTitle')}</button>
                <button id="systemPromptSaveBtn" class="btn-copy">${t('common.save')}</button>
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
        setStatus(t('ai.debug.systemPromptSaved'), 'success');
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    textarea.focus();
}
