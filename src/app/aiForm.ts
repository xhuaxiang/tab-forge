/**
 * aiForm — AI 即兴生成表单事件绑定
 */

import { $, setStatus } from './dom.ts';
import { scoreStore } from '../core/stores/scoreStore.ts';
import { getApiKey, saveApiKey, generateImprovisation, isSystemPromptTrigger, openSystemPromptEditor, openPromptDebug, type GenerationOptions } from '../features/ai/index.ts';
import { IMPROV_CONFIG } from '../core/config.ts';

/** 从 IMPROV_CONFIG 生成即兴选项下拉（小节数/音阶/风格/密度），单一来源 */
function initImprovConfig(): void {
    const fillSelect = (id: string, options: ReadonlyArray<{ value: string; label: string }>, defaultVal: string): void => {
        const sel = document.getElementById(id) as HTMLSelectElement | null;
        if (!sel) return;
        sel.innerHTML = '';
        for (const o of options) {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            if (o.value === defaultVal) opt.selected = true;
            sel.appendChild(opt);
        }
    };

    const numSel = document.getElementById('aiNumMeasures') as HTMLSelectElement | null;
    if (numSel) {
        numSel.innerHTML = '';
        for (const n of IMPROV_CONFIG.numMeasures.options) {
            const opt = document.createElement('option');
            opt.value = String(n);
            opt.textContent = String(n);
            if (n === IMPROV_CONFIG.numMeasures.default) opt.selected = true;
            numSel.appendChild(opt);
        }
    }
    fillSelect('aiScaleType', IMPROV_CONFIG.scaleTypes, IMPROV_CONFIG.scaleTypes[0].value);
    fillSelect('aiStyle', IMPROV_CONFIG.styles, IMPROV_CONFIG.styles[0].value);
    fillSelect('aiDensity', IMPROV_CONFIG.densities, IMPROV_CONFIG.densities[1].value);
}

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

/** 处理 AI 生成按钮点击 */
async function handleAIGenerate(): Promise<void> {
    // 隐藏功能：额外要求填「修改系统对话」→ 打开系统提示词编辑弹窗（不依赖 API Key）
    const extraPrompt = (document.getElementById('aiExtraPrompt') as HTMLInputElement)?.value?.trim();
    if (isSystemPromptTrigger(extraPrompt)) {
        openSystemPromptEditor();
        return;
    }

    const apiKeyInput = document.getElementById('aiApiKey') as HTMLInputElement;
    const statusEl = document.getElementById('aiGenStatus');
    const btn = document.getElementById('aiGenerateBtn') as HTMLButtonElement;

    const apiKey = apiKeyInput?.value?.trim();
    if (!apiKey) {
        setStatus('请先输入 DeepSeek API Key', 'error');
        if (statusEl) statusEl.textContent = '⚠️ 请先输入 API Key';
        return;
    }

    // 保存 Key
    await saveApiKey(apiKey);

    // 最少 3 小节，避免 AI 产出过短（如 1 拍）；默认值统一取 IMPROV_CONFIG
    const numMeasures = Math.max(IMPROV_CONFIG.numMeasures.min, parseInt((document.getElementById('aiNumMeasures') as HTMLSelectElement)?.value || String(IMPROV_CONFIG.numMeasures.default), 10));
    const scaleType = (document.getElementById('aiScaleType') as HTMLSelectElement)?.value || IMPROV_CONFIG.scaleTypes[0].value;
    const style = (document.getElementById('aiStyle') as HTMLSelectElement)?.value || IMPROV_CONFIG.styles[0].value;
    const density = (document.getElementById('aiDensity') as HTMLSelectElement)?.value || IMPROV_CONFIG.densities[1].value;

    const options: GenerationOptions = {
        numMeasures,
        scaleType,
        style,
        density,
        extraPrompt: extraPrompt || undefined,
    };

    // UI 反馈：禁用按钮，显示加载状态
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 生成中...';
    }
    if (statusEl) statusEl.textContent = '⏳ 正在调用 DeepSeek AI...';
    setStatus('⏳ AI 正在生成即兴谱...', 'info');

    // 确保至少有一个小节
    if (scoreStore.score.measures.length === 0) {
        scoreStore.addMeasure();
    }

    try {
        const result = await generateImprovisation(scoreStore.score, options, apiKey);

        if (result.error) {
            setStatus(`AI 生成失败: ${result.error}`, 'error');
            if (statusEl) statusEl.textContent = `❌ ${result.error}`;
            return;
        }

        if (result.notes.length === 0) {
            setStatus('AI 未返回有效音符', 'error');
            if (statusEl) statusEl.textContent = '❌ AI 未返回有效音符';
            return;
        }

        // 用拍平音符重建整谱（loadNotes 内部：beginBatch → 清空 → 按容量切小节 → 补足小节数 → 统一渲染）
        const written = scoreStore.loadNotes(result.notes, numMeasures);

        setStatus(`✅ AI 已生成 ${written} 个音符`, 'success');
        if (statusEl) statusEl.textContent = `✅ 成功！已生成 ${result.notes.length} 个音符，${scoreStore.score.measures.length} 个小节`;
    } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误';
        setStatus(`AI 调用异常: ${msg}`, 'error');
        if (statusEl) statusEl.textContent = `❌ 异常: ${msg}`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🤖 生成即兴谱';
        }
    }
}

export function initAIForm(): void {
    // 初始化 API Key 输入框 + 选项下拉（从 IMPROV_CONFIG 生成）
    initAIKeyInput();
    initImprovConfig();

    // Toolbar 快速按钮：打开 AI 设置面板
    $('aiImprovBtn')?.addEventListener('click', () => {
        const panel = document.getElementById('aiSettingsPanel') as HTMLDetailsElement;
        if (panel) {
            panel.open = true;
            panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // AI 生成按钮
    $('aiGenerateBtn')?.addEventListener('click', handleAIGenerate);

    // Prompt 调试面板
    $('aiPromptDebugBtn')?.addEventListener('click', openPromptDebug);
}
