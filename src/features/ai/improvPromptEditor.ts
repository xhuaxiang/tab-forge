/**
 * improvPromptEditor — 新「本地底稿 + AI 扩展」两段提示词的编辑与存储。
 *
 * 两个存储键分别对应「需求解析（brief）」与「表现扩展（patch）」。存的是
 * 可编辑的专业性描述；机器契约由 compose*SystemPrompt 在发请求前恒定追加，
 * 不展示、不可编辑。
 *
 * 与旧 systemPromptEditor 的关系：旧键 `TabForge_CustomSystemPrompt` 不再
 * 参与新流程（语义是「从零生成」），这里只检测并提示，不自动迁移。
 * 本文件不 import `app/dom.ts`：状态展示通过 `onStatus` 回调由 app 层传入。
 */

import { DEFAULT_BRIEF_PROMPT, composeBriefSystemPrompt, stripBriefContract } from './improvBriefPrompt.ts';
import { DEFAULT_PATCH_PROMPT, composePatchSystemPrompt, stripPatchContract } from './improvPatchPrompt.ts';

const BRIEF_STORAGE_KEY = 'TabForge_CustomImprovBriefPrompt';
const PATCH_STORAGE_KEY = 'TabForge_CustomImprovPatchPrompt';
/** 旧「从零生成」提示词键：只检测，不读取生效 */
const LEGACY_STORAGE_KEY = 'TabForge_CustomSystemPrompt';

function isChromeExtension(): boolean {
    return typeof chrome !== 'undefined' && !!chrome.storage;
}

async function readStored(key: string): Promise<string | null> {
    if (isChromeExtension()) {
        try {
            const result = await chrome.storage.local.get<Record<string, string>>(key);
            return result[key] || null;
        } catch {
            return null;
        }
    }
    try {
        return localStorage.getItem(key) || null;
    } catch {
        return null;
    }
}

async function writeStored(key: string, value: string): Promise<void> {
    if (isChromeExtension()) {
        await chrome.storage.local.set({ [key]: value });
        return;
    }
    try {
        localStorage.setItem(key, value);
    } catch { /* ignore */ }
}

/** 自定义 brief 描述（已剥掉内嵌契约）；未设置为 null */
export async function getCustomBriefPrompt(): Promise<string | null> {
    const raw = await readStored(BRIEF_STORAGE_KEY);
    return raw ? stripBriefContract(raw) : null;
}

/** 自定义 patch 描述（已剥掉内嵌契约）；未设置为 null */
export async function getCustomPatchPrompt(): Promise<string | null> {
    const raw = await readStored(PATCH_STORAGE_KEY);
    return raw ? stripPatchContract(raw) : null;
}

export async function saveCustomBriefPrompt(prompt: string): Promise<void> {
    await writeStored(BRIEF_STORAGE_KEY, prompt);
}

export async function saveCustomPatchPrompt(prompt: string): Promise<void> {
    await writeStored(PATCH_STORAGE_KEY, prompt);
}

/** 编辑器预填值：自定义优先，否则默认描述 */
export async function getEditableBriefPrompt(): Promise<string> {
    const custom = await getCustomBriefPrompt();
    return custom?.trim() ? custom : DEFAULT_BRIEF_PROMPT;
}

export async function getEditablePatchPrompt(): Promise<string> {
    const custom = await getCustomPatchPrompt();
    return custom?.trim() ? custom : DEFAULT_PATCH_PROMPT;
}

/** 发请求用的完整 system prompt（描述 + 代码追加的契约） */
export async function getEffectiveBriefPrompt(): Promise<string> {
    return composeBriefSystemPrompt(await getEditableBriefPrompt());
}

export async function getEffectivePatchPrompt(): Promise<string> {
    return composePatchSystemPrompt(await getEditablePatchPrompt());
}

export interface ImprovPromptEditorOptions {
    /** 状态回调；由 app 层传入（本文件不碰 app/dom） */
    onStatus?: (message: string, kind?: 'info' | 'success' | 'error') => void;
}

/** 打开两段提示词的编辑弹窗 */
export function openImprovPromptEditor(options: ImprovPromptEditorOptions = {}): void {
    void (async () => {
        const [brief, patch, legacy] = await Promise.all([
            getEditableBriefPrompt(),
            getEditablePatchPrompt(),
            readStored(LEGACY_STORAGE_KEY),
        ]);
        buildModal(brief, patch, legacy !== null && legacy.trim() !== '', options);
    })();
}

function buildModal(
    brief: string,
    patch: string,
    hasLegacy: boolean,
    options: ImprovPromptEditorOptions,
): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>✏️ 修改 AI 即兴提示词</h3>
            <p class="modal-hint">本地负责出合法底稿，AI 只做两件事：解析额外要求、在底稿上加奏法与表情。机器契约由程序追加，不在此编辑。</p>
            <div class="modal-footer" style="justify-content:flex-start; gap:6px; margin:0 0 4px;">
                <strong style="font-size:12px;">1. 需求解析（brief）</strong>
                <button id="improvBriefRestore" class="btn-copy" style="margin-left:auto;">恢复默认</button>
            </div>
            <textarea class="modal-textarea" id="improvBriefTextarea" style="min-height:160px;"></textarea>
            <div class="modal-footer" style="justify-content:flex-start; gap:6px; margin:10px 0 4px;">
                <strong style="font-size:12px;">2. 表现扩展（patch）</strong>
                <button id="improvPatchRestore" class="btn-copy" style="margin-left:auto;">恢复默认</button>
            </div>
            <textarea class="modal-textarea" id="improvPatchTextarea" style="min-height:200px;"></textarea>
            <p class="modal-hint" id="improvLegacyNotice" style="display:${hasLegacy ? 'block' : 'none'};">
                检测到旧版「从零生成」提示词（TabForge_CustomSystemPrompt），已保留但未启用；可手动复制到上方文本框。
            </p>
            <div class="modal-footer">
                <button id="improvPromptCancelBtn">取消</button>
                <button id="improvPromptSaveBtn" class="btn-copy">保存</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const briefArea = modal.querySelector('#improvBriefTextarea') as HTMLTextAreaElement;
    const patchArea = modal.querySelector('#improvPatchTextarea') as HTMLTextAreaElement;
    briefArea.value = brief;
    patchArea.value = patch;

    const close = (): void => {
        document.body.removeChild(modal);
    };

    modal.querySelector('#improvBriefRestore')?.addEventListener('click', () => {
        briefArea.value = DEFAULT_BRIEF_PROMPT;
    });
    modal.querySelector('#improvPatchRestore')?.addEventListener('click', () => {
        patchArea.value = DEFAULT_PATCH_PROMPT;
    });
    modal.querySelector('#improvPromptCancelBtn')?.addEventListener('click', close);
    modal.querySelector('#improvPromptSaveBtn')?.addEventListener('click', async () => {
        await saveCustomBriefPrompt(briefArea.value);
        await saveCustomPatchPrompt(patchArea.value);
        close();
        options.onStatus?.('AI 即兴提示词已保存，对后续生成生效', 'success');
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    briefArea.focus();
}
