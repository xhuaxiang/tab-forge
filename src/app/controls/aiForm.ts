/**
 * aiForm — AI 即兴面板（本地底稿 + AI 表现扩展）。
 *
 * 面板选项与当前乐谱作为 base，额外要求交给本地关键词解析 + AI brief，
 * 本地生成器出合法底稿，AI patch 只加奏法与表情。无 Key / 任一段失败
 * 都只降级 AI，底稿照样写谱。
 */

import { $, setStatus } from '../dom.ts';
import { scoreStore } from '../../core/stores/scoreStore.ts';
import type { Note } from '../../core/types/index.ts';
import type {
    ImprovBriefOptions,
    LocalDensity,
    LocalStyle,
    ResolvedImprovOptions,
    ScaleType,
} from '../../core/types/improv/index.ts';
import {
    LOCAL_DENSITIES,
    LOCAL_STYLES,
    SCALE_TYPES,
} from '../../core/types/improv/index.ts';
import { LOCAL_IMPROV_CONFIG } from '../../core/config.ts';
import {
    detectUnsupportedDescriptionItems,
    parseImprovDescription,
} from '../../core/utils/improv/index.ts';
import { t } from '../../core/i18n/index.ts';
import {
    getApiKey,
    saveApiKey,
    isSystemPromptTrigger,
    openImprovPromptEditor,
    openImprovPromptDebug,
    runImprovPipeline,
} from '../../features/ai/index.ts';
import { buildImprovSummary } from './improvSummary.ts';
import { refreshAiImprovOptions } from './improvRefresh.ts';
import { setAiSummarySnapshot, setAiSummaryText } from './improvSummaryState.ts';

/** 初始化 API Key 输入框（从存储中加载已保存的 Key） */
async function initAIKeyInput(): Promise<void> {
    const input = document.getElementById('aiApiKey') as HTMLInputElement;
    if (!input) return;
    const saved = await getApiKey();
    if (saved) {
        input.value = saved;
    }
    // API Key 在 summary 右侧：点击输入框不折叠面板
    input.addEventListener('click', (e) => e.stopPropagation());
    // 修改时自动保存
    input.addEventListener('change', () => {
        saveApiKey(input.value.trim());
    });
}

function readSelect<T extends string>(
    id: string,
    options: readonly T[],
    fallback: T,
): T {
    const value = (document.getElementById(id) as HTMLSelectElement | null)?.value;
    return value !== undefined && (options as readonly string[]).includes(value)
        ? value as T
        : fallback;
}

/** 读取面板选项 + 当前乐谱元数据，合成 brief 的 base */
function readBaseOptions(): ImprovBriefOptions {
    const rawNum = Number(
        (document.getElementById('aiNumMeasures') as HTMLSelectElement | null)?.value,
    );
    const { min, max } = LOCAL_IMPROV_CONFIG.numMeasures;
    const numMeasures = Number.isFinite(rawNum)
        ? Math.max(min, Math.min(max, Math.round(rawNum)))
        : LOCAL_IMPROV_CONFIG.defaults.numMeasures;

    return {
        numMeasures,
        key: scoreStore.score.key || undefined,
        timeSignature: scoreStore.score.timeSignature || undefined,
        scaleType: readSelect<ScaleType>(
            'aiScaleType', SCALE_TYPES, LOCAL_IMPROV_CONFIG.defaults.scaleType,
        ),
        style: readSelect<LocalStyle>(
            'aiStyle', LOCAL_STYLES, LOCAL_IMPROV_CONFIG.defaults.style,
        ),
        density: readSelect<LocalDensity>(
            'aiDensity', LOCAL_DENSITIES, LOCAL_IMPROV_CONFIG.defaults.density,
        ),
    };
}

function setSelectValue(id: string, value: string): void {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (select && Array.from(select.options).some(option => option.value === value)) {
        select.value = value;
    }
}

/** 把音符与生效选项写进 store（主流程与调试面板共用） */
function writeGeneratedScore(notes: Note[], options: ResolvedImprovOptions): void {
    // 先落 store 的拍号/调性，loadNotes 才会按新拍号切小节
    scoreStore.beginBatch();
    try {
        if (scoreStore.score.timeSignature !== options.timeSignature) {
            scoreStore.setTimeSignature(options.timeSignature);
        }
        if (scoreStore.score.key !== options.key) {
            scoreStore.setKey(options.key);
        }
        scoreStore.loadNotes(notes, options.numMeasures);
    } finally {
        scoreStore.endBatch();
    }
    syncAIFormControls(options);
}

/** 把最终生效的选项回写到面板与顶部下拉（描述/AI 覆盖后保持同步） */
function syncAIFormControls(options: ResolvedImprovOptions): void {
    setSelectValue('aiNumMeasures', String(options.numMeasures));
    setSelectValue('aiStyle', options.style);
    setSelectValue('aiScaleType', options.scaleType);
    setSelectValue('aiDensity', options.density);
    setSelectValue('keySelect', options.key);
    setSelectValue('timeSigSelect', options.timeSignature);
}

/** 处理 AI 生成按钮点击 */
async function handleAIGenerate(): Promise<void> {
    // 隐藏功能：额外要求填「修改系统对话」→ 打开提示词编辑弹窗（不依赖 API Key）
    const extraPrompt = (document.getElementById('aiExtraPrompt') as HTMLInputElement)?.value?.trim() ?? '';
    if (isSystemPromptTrigger(extraPrompt)) {
        openImprovPromptEditor({ onStatus: setStatus });
        return;
    }

    const apiKeyInput = document.getElementById('aiApiKey') as HTMLInputElement;
    const statusEl = document.getElementById('aiGenStatus');
    const btn = document.getElementById('aiGenerateBtn') as HTMLButtonElement;
    // 无 Key 不再阻塞：只跳过两段 AI，本地底稿照常生成
    const apiKey = apiKeyInput?.value?.trim() || null;
    if (apiKey) await saveApiKey(apiKey);

    if (btn) {
        btn.disabled = true;
        btn.textContent = t('improv.generating');
    }
    setStatus(t('improv.localGenerating'), 'info');
    if (statusEl) statusEl.textContent = t('improv.localGenerating');

    // 确保至少有一个小节
    if (scoreStore.score.measures.length === 0) {
        scoreStore.addMeasure();
    }

    const seed = Math.floor(Math.random() * 0x100000000) >>> 0;
    const base = readBaseOptions();
    const described = parseImprovDescription(extraPrompt);

    try {
        const result = await runImprovPipeline({
            score: scoreStore.score,
            base,
            extraPrompt,
            apiKey,
            seed,
        });

        if (result.fatal || !result.notes || !result.local) {
            const message = result.error ?? t('improv.localFailed');
            setStatus(t('ai.localDraftFailedWith', { message }), 'error');
            if (statusEl) statusEl.textContent = t('improv.errorPrefix', { message });
            // 失败必须清掉旧快照，否则切语言会把错误条覆盖成上次成功摘要
            setAiSummaryText(null);
            return;
        }

        const { local, notes } = result;
        writeGeneratedScore(notes, local.options);

        // 本地不支持项；AI brief 已翻译掉的 CAGED 提示不再重复展示。
        // 按结构化 code 过滤——旧实现匹配中文前缀，文案一变就静默失效。
        const items = detectUnsupportedDescriptionItems(extraPrompt);
        const translatedCaged = result.brief?.options.fingering !== undefined;
        const shownItems = translatedCaged ? items.filter(item => item.code !== 'caged') : items;
        // AI 原文与 pipeline 消息保留生成时语言，其余部分切语言时重建
        const aiWarnings = [...(result.brief?.unsupported ?? []), ...result.messages];
        const shownWarnings = [...shownItems.map(item => t(item.key)), ...aiWarnings];

        const summary = buildImprovSummary(
            local, seed, extraPrompt, described, shownWarnings,
        );
        const sounding = notes.filter(note => !note.isRest).length;
        const applied = result.apply?.applied ?? 0;
        const dropped = result.apply?.dropped.length ?? 0;
        const aiText = apiKey
            ? t('ai.extensionApplied', {
                applied,
                note: dropped > 0 ? t('ai.extensionDropped', { count: dropped }) : '',
            })
            : t('ai.extensionSkipped');
        const headline = t('ai.headline', { notes: sounding, aiText });

        setStatus(headline, 'success');
        setAiSummarySnapshot({
            sounding,
            hasApiKey: apiKey !== null,
            applied,
            dropped,
            rationale: result.brief?.rationale ?? '',
            result: local,
            seed,
            description: extraPrompt,
            described,
            warningKeys: shownItems.map(item => item.key),
            aiWarnings,
        });
        if (statusEl) {
            statusEl.textContent = [
                headline,
                result.brief?.rationale ? t('ai.rationale', { rationale: result.brief.rationale }) : '',
                summary,
            ].filter(Boolean).join('\n');
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : t('ai.unknownError');
        setStatus(t('ai.exceptionWith', { message: msg }), 'error');
        if (statusEl) {
            statusEl.textContent = t('ai.exceptionPrefix', { message: msg });
            setAiSummaryText(statusEl.textContent);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = t('ai.generate');
        }
    }
}

export function initAIForm(): void {
    // 初始化 API Key 输入框 + 选项下拉
    initAIKeyInput();
    refreshAiImprovOptions();

    // AI 生成按钮
    $('aiGenerateBtn')?.addEventListener('click', handleAIGenerate);

    // Prompt 调试面板（新两段式：需求解析 / 表现扩展）
    $('aiPromptDebugBtn')?.addEventListener('click', () => {
        const apiKey = (document.getElementById('aiApiKey') as HTMLInputElement | null)
            ?.value?.trim() ?? '';
        const extraPrompt = (document.getElementById('aiExtraPrompt') as HTMLInputElement | null)
            ?.value?.trim() ?? '';
        openImprovPromptDebug({
            apiKey,
            extraPrompt,
            base: readBaseOptions(),
            score: scoreStore.score,
            onStatus: setStatus,
            onWriteScore: writeGeneratedScore,
        });
    });
}
