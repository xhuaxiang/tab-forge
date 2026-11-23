/**
 * app/i18n — 语言检测、持久化与 DOM 应用。
 *
 * core/i18n 只存纯字典与当前语言；这里负责读写存储、写 DOM 属性，
 * 以及语言切换后的就地刷新（绝不重跑 initEventListeners / initRenderer）。
 */

import {
    detectLocaleFromLanguage,
    getLocale,
    hasMessage,
    isLocale,
    setLocale,
    t,
    type Locale,
} from '../core/i18n/index.ts';
import { readStorage, writeStorage } from '../features/storage.ts';
import { refreshStatus } from './dom.ts';
import { refreshFretOptions } from './eventHandlers.ts';
import { refreshSearchSelectNoResults } from './input/searchSelect.ts';
import { updateStrumButton, updateArpeggioButton } from './input/chordInput.ts';
import { refreshPlaybackLabels } from './playback/playbackControls.ts';
import { refreshImprovOptions } from './controls/improvRefresh.ts';
import { renderImprovSummaries } from './controls/improvSummaryState.ts';
import { refreshEditUiText } from '../features/alphaTab/scoreEditing.ts';
import { renderHighlight } from './render/render.ts';

export const UI_LANGUAGE_STORAGE_KEY = 'TabForge_UiLanguage';

const STORAGE_TIMEOUT_MS = 800;

// ============================================================
// 存储（extension: chrome.storage.local / web: localStorage）
// ============================================================

/** 存储读取卡住时用系统语言先启动，避免 popup 长期白屏 */
function withTimeout<T>(promise: Promise<T>, fallback: T, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ============================================================
// 静态 HTML 钩子
// ============================================================

const HOOKS: ReadonlyArray<readonly [string, string]> = [
    ['data-i18n', 'i18n'],
    ['data-i18n-title', 'i18nTitle'],
    ['data-i18n-placeholder', 'i18nPlaceholder'],
    ['data-i18n-aria-label', 'i18nAriaLabel'],
    ['data-i18n-content', 'i18nContent'],
    ['data-i18n-label', 'i18nLabel'],
];

const warnedKeys = new Set<string>();

function applyHook(element: HTMLElement, prop: string, message: string): void {
    switch (prop) {
        case 'i18n':
            element.textContent = message;
            break;
        case 'i18nTitle':
            element.setAttribute('title', message);
            break;
        case 'i18nPlaceholder':
            element.setAttribute('placeholder', message);
            break;
        case 'i18nAriaLabel':
            element.setAttribute('aria-label', message);
            break;
        case 'i18nContent':
            element.setAttribute('content', message);
            break;
        case 'i18nLabel':
            element.setAttribute('label', message);
            break;
    }
}

/** 套用 data-i18n* 钩子；未知 key 只告警一次，绝不把 key 写进界面 */
export function applyStaticTranslations(root: ParentNode = document): void {
    for (const [selector, prop] of HOOKS) {
        root.querySelectorAll<HTMLElement>(`[${selector}]`).forEach(element => {
            const key = element.dataset[prop];
            if (!key) return;
            if (!hasMessage(key)) {
                if (!warnedKeys.has(key)) {
                    warnedKeys.add(key);
                    console.warn(`[TabForge] 未知的 i18n key: ${key}`);
                }
                return;
            }
            applyHook(element, prop, t(key));
        });
    }
}

// ============================================================
// 语言下拉
// ============================================================

function syncLanguageSelect(): void {
    const select = document.getElementById('uiLanguageSelect') as HTMLSelectElement | null;
    if (select) select.value = getLocale();
}

let languageControlInited = false;

/** 绑定语言下拉（只绑一次；程序化 set value 不会触发 change） */
export function initLanguageControl(): void {
    const select = document.getElementById('uiLanguageSelect') as HTMLSelectElement | null;
    if (!select) return;
    select.value = getLocale();
    if (languageControlInited) return;
    languageControlInited = true;

    select.addEventListener('change', () => {
        const value = select.value;
        if (!isLocale(value)) {
            select.value = getLocale();
            return;
        }
        void applyLocale(value);
    });
}

// ============================================================
// 启动与切换
// ============================================================

function runStep(step: () => void): void {
    try {
        step();
    } catch (error) {
        console.warn('[TabForge] 语言刷新步骤失败', error);
    }
}

/** 启动时调用：确定语言 → 套用静态文案 → 绑定下拉。返回最终 locale */
export async function initI18n(): Promise<Locale> {
    const stored = await withTimeout(readStorage(UI_LANGUAGE_STORAGE_KEY), null, STORAGE_TIMEOUT_MS);
    const systemLanguage = typeof navigator !== 'undefined' ? navigator.language : null;
    const locale = isLocale(stored) ? stored : detectLocaleFromLanguage(systemLanguage);

    setLocale(locale);
    document.documentElement.lang = locale;
    applyStaticTranslations(document);
    initLanguageControl();
    return locale;
}

/** 持久化串行化：连续快速切换时保证最终落盘的是最后一次选择 */
let writeChain: Promise<void> = Promise.resolve();

function queueLocaleWrite(locale: Locale): void {
    writeChain = writeChain.then(() => writeStorage(UI_LANGUAGE_STORAGE_KEY, locale));
}

let applying = false;

/**
 * 切换语言并就地刷新所有可见文案。
 * 只调用幂等的刷新函数；禁止调用任何 init*（会重复绑定监听或重建渲染器）。
 */
export async function applyLocale(locale: Locale, options?: { persist?: boolean }): Promise<void> {
    if (applying || !isLocale(locale)) return;
    applying = true;
    try {
        if (options?.persist !== false) queueLocaleWrite(locale);
        setLocale(locale);
        document.documentElement.lang = locale;

        runStep(() => applyStaticTranslations(document));
        runStep(refreshFretOptions);
        runStep(refreshImprovOptions);
        runStep(refreshSearchSelectNoResults);
        runStep(updateStrumButton);
        runStep(updateArpeggioButton);
        runStep(refreshEditUiText);
        runStep(refreshPlaybackLabels);
        runStep(renderImprovSummaries);
        // 刷新 HUD / 小节导航 / 空谱提示与选中框；不 load 谱面、不重建渲染器
        runStep(renderHighlight);
        runStep(refreshStatus);
        syncLanguageSelect();
    } finally {
        applying = false;
    }
}
