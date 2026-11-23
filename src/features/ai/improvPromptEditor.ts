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

import { t } from '../../core/i18n/index.ts';
import { readStorage, writeStorage } from '../storage.ts';
import { DEFAULT_BRIEF_PROMPT, composeBriefSystemPrompt, stripBriefContract } from './improvBriefPrompt.ts';
import { DEFAULT_PATCH_PROMPT, composePatchSystemPrompt, stripPatchContract } from './improvPatchPrompt.ts';

const BRIEF_STORAGE_KEY = 'TabForge_CustomImprovBriefPrompt';
const PATCH_STORAGE_KEY = 'TabForge_CustomImprovPatchPrompt';
/** 旧「从零生成」提示词键：只检测，不读取生效 */
const LEGACY_STORAGE_KEY = 'TabForge_CustomSystemPrompt';

/** 自定义 brief 描述（已剥掉内嵌契约）；未设置为 null */
export async function getCustomBriefPrompt(): Promise<string | null> {
    const raw = await readStorage(BRIEF_STORAGE_KEY);
    return raw ? stripBriefContract(raw) : null;
}

/** 自定义 patch 描述（已剥掉内嵌契约）；未设置为 null */
export async function getCustomPatchPrompt(): Promise<string | null> {
    const raw = await readStorage(PATCH_STORAGE_KEY);
    return raw ? stripPatchContract(raw) : null;
}

export async function saveCustomBriefPrompt(prompt: string): Promise<void> {
    await writeStorage(BRIEF_STORAGE_KEY, prompt);
}

export async function saveCustomPatchPrompt(prompt: string): Promise<void> {
    await writeStorage(PATCH_STORAGE_KEY, prompt);
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
            readStorage(LEGACY_STORAGE_KEY),
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
            <h3>${t('ai.editor.improvTitle')}</h3>
            <p class="modal-hint">${t('ai.editor.improvHint')}</p>
            <div class="modal-footer" style="justify-content:flex-start; gap:6px; margin:0 0 4px;">
                <strong style="font-size:12px;">${t('ai.editor.briefHeading')}</strong>
                <button id="improvBriefRestore" class="btn-copy" style="margin-left:auto;">${t('common.restoreDefault')}</button>
            </div>
            <textarea class="modal-textarea" id="improvBriefTextarea" style="min-height:160px;"></textarea>
            <div class="modal-footer" style="justify-content:flex-start; gap:6px; margin:10px 0 4px;">
                <strong style="font-size:12px;">${t('ai.editor.patchHeading')}</strong>
                <button id="improvPatchRestore" class="btn-copy" style="margin-left:auto;">${t('common.restoreDefault')}</button>
            </div>
            <textarea class="modal-textarea" id="improvPatchTextarea" style="min-height:200px;"></textarea>
            <p class="modal-hint" id="improvLegacyNotice" style="display:${hasLegacy ? 'block' : 'none'};">
                ${t('ai.editor.legacyPromptWarning')}
            </p>
            <div class="modal-footer">
                <button id="improvPromptCancelBtn">${t('common.cancelTitle')}</button>
                <button id="improvPromptSaveBtn" class="btn-copy">${t('common.save')}</button>
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
        options.onStatus?.(t('ai.debug.promptSaved'), 'success');
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    briefArea.focus();
}
