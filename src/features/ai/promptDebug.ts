/**
 * promptDebug — AI 即兴 Prompt 调试面板（供调参 / 交接他人使用）
 *
 * 同时展示并编辑两段最终会发给 DeepSeek 的提示词：
 *   ① 系统提示词 System Prompt —— 只放「专业性描述」（人格 / 节奏 / 旋律 / 演奏约束）
 *   ② 用户提示词 User Prompt   —— 每次生成的具体指令（默认由 buildUserPrompt 生成，可临时改）
 * 提供「生成测试」直接调用并展示 AI 原始响应，方便快速迭代。
 *
 * ① 不展示数据结构：契约在发送前由 composeSystemPrompt 恒定追加，改了也白改，故不给看。
 *
 * 找到合适的两段后回写进代码：① → promptBuilder.ts，② → buildUserPrompt 函数。
 */

import { scoreStore } from '../../core/stores/scoreStore.ts';
import { IMPROV_CONFIG } from '../../core/config.ts';
import {
    composeSystemPrompt, DEFAULT_EXPERT_PROMPT, buildUserPrompt, type GenerationOptions,
} from './promptBuilder.ts';
import { getEditableSystemPrompt, saveCustomSystemPrompt } from './systemPromptEditor.ts';
import { getApiKey, debugGenerate } from './aiService.ts';
import { setStatus } from '../../app/dom.ts';

/**
 * 从 AI 面板控件读取当前生成选项。
 * @param overrides 调试面板内的临时选择（风格/密度下拉），不写回 AI 面板
 */
function readCurrentOptions(overrides: Partial<GenerationOptions> = {}): GenerationOptions {
    const num = document.getElementById('aiNumMeasures') as HTMLSelectElement | null;
    const scale = document.getElementById('aiScaleType') as HTMLSelectElement | null;
    const style = document.getElementById('aiStyle') as HTMLSelectElement | null;
    const density = document.getElementById('aiDensity') as HTMLSelectElement | null;
    return {
        numMeasures: Math.max(
            IMPROV_CONFIG.numMeasures.min,
            parseInt(num?.value || String(IMPROV_CONFIG.numMeasures.default), 10),
        ),
        scaleType: scale?.value || IMPROV_CONFIG.scaleTypes[0].value,
        style: style?.value || IMPROV_CONFIG.styles[0].value,
        density: density?.value || IMPROV_CONFIG.densities[1].value,
        ...overrides,
    };
}

/** 当前调试面板里选中的风格/密度（未选则回落 AI 面板的值） */
function readPanelOverrides(modal: HTMLElement): Partial<GenerationOptions> {
    const style = (modal.querySelector('#pdStyle') as HTMLSelectElement | null)?.value;
    const density = (modal.querySelector('#pdDensity') as HTMLSelectElement | null)?.value;
    return {
        ...(style ? { style } : {}),
        ...(density ? { density } : {}),
    };
}

/** 用 IMPROV_CONFIG 填充一个下拉（与 AI 面板同源，不另写选项表） */
function fillSelect(sel: HTMLSelectElement, options: ReadonlyArray<{ value: string; label: string }>, current: string): void {
    sel.innerHTML = '';
    for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === current) opt.selected = true;
        sel.appendChild(opt);
    }
}

/** 打开 Prompt 调试弹窗 */
export function openPromptDebug(): void {
    void (async () => {
        const system = await getEditableSystemPrompt();
        const user = buildUserPrompt(readCurrentOptions());
        buildModal(system, user);
    })();
}

function buildModal(initialSystem: string, initialUser: string): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:720px; max-height:88vh; overflow-y:auto;">
            <h3>🧪 Prompt 调试</h3>
            <p style="font-size:12px;color:var(--text-muted);margin:2px 0 8px;line-height:1.5;">
                改上面两段提示词 → 点「▶ 用上方提示词生成」→ 谱面写入乐谱，本窗口**不关**，
                下方显示 AI 原始响应，方便核对模型到底发了什么。
                找到合适组合后回写进代码：① → <code>src/features/ai/promptBuilder.ts</code>，
                ② → <code>buildUserPrompt</code> 函数。
            </p>

            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:2px;">① 系统提示词（System Prompt）</div>
            <p style="font-size:11px;color:var(--text-muted);margin:0 0 4px;line-height:1.5;">
                给 AI 的「角色与规则」：告诉它你是谁、节奏/旋律/技法要求。影响 AI「怎么想、怎么生成」。
                音符对象格式 / 输出格式属于数据结构，由代码恒定追加 —— 这里不展示也改不了。
                点「保存系统提示词」后对所有生成生效（存本地，覆盖代码默认）。
            </p>
            <textarea class="modal-textarea" id="pdSystem" style="min-height:140px;font-size:13px;line-height:1.6;color:var(--text-primary);"></textarea>

            <div style="display:flex;gap:8px;align-items:center;margin:8px 0 2px;">
                <span style="font-size:12px;color:var(--text-muted);">试风格/密度：</span>
                <select id="pdStyle" class="compact-select" style="width:auto;"></select>
                <select id="pdDensity" class="compact-select" style="width:auto;"></select>
            </div>

            <div style="font-size:13px;color:var(--text-secondary);margin:8px 0 2px;">② 用户提示词（User Prompt）</div>
            <p style="font-size:11px;color:var(--text-muted);margin:0 0 4px;line-height:1.5;">
                发给 AI 的「本次任务」：要生成几小节、当前乐谱状态（调性/BPM/拍号/调弦）、密度/风格要求。
                默认由代码 buildUserPrompt 自动生成，这里可临时改写来试验不同写法。（如果没有内容，以上面的系统提示次为主）
            </p>
            <textarea class="modal-textarea" id="pdUser" style="min-height:100px;font-size:13px;line-height:1.6;color:var(--text-primary);"></textarea>

            <div class="modal-actions" style="margin-top:8px;">
                <button id="pdTest" class="btn-copy">▶ 用上方提示词生成</button>
                <button id="pdSave">💾 保存系统提示词</button>
                <button id="pdReset">↺ 恢复默认系统提示词</button>
                <button id="pdRegen">⟳ 重新生成用户提示词</button>
                <button id="pdCopyRaw">📋 复制原始响应</button>
            </div>

            <div id="pdResult" style="font-size:11px;color:var(--text-muted);margin-top:8px;min-height:40px;white-space:pre-wrap;word-break:break-word;"></div>

            <div class="modal-footer">
                <button id="pdClose">关闭</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const byId = <T extends HTMLElement>(id: string): T => modal.querySelector(`#${id}`) as T;
    const systemTa = byId<HTMLTextAreaElement>('pdSystem');
    const userTa = byId<HTMLTextAreaElement>('pdUser');
    const resultEl = byId<HTMLDivElement>('pdResult');
    systemTa.value = initialSystem;
    userTa.value = initialUser;

    // 风格/密度：初值跟随 AI 面板，切换即按同一套文案重建 user prompt
    // （文案来自 core/config.ts，与正式生成走的是同一个 buildUserPrompt —— 不在这里另写一份）
    const styleSel = byId<HTMLSelectElement>('pdStyle');
    const densitySel = byId<HTMLSelectElement>('pdDensity');
    const baseOptions = readCurrentOptions();
    fillSelect(styleSel, IMPROV_CONFIG.styles, baseOptions.style);
    fillSelect(densitySel, IMPROV_CONFIG.densities, baseOptions.density);
    const rebuildUser = (): void => {
        userTa.value = buildUserPrompt(readCurrentOptions(readPanelOverrides(modal)));
    };
    styleSel.addEventListener('change', rebuildUser);
    densitySel.addEventListener('change', rebuildUser);

    const close = (): void => { document.body.removeChild(modal); };

    /** 最近一次 AI 原始响应，供「复制原始响应」取用 */
    let lastRaw = '';
    modal.querySelector('#pdClose')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    // 生成测试：用当前两段内容直接调用 DeepSeek，成功后把音符应用到乐谱
    modal.querySelector('#pdTest')?.addEventListener('click', async () => {
        const apiKey = (await getApiKey())
            || (document.getElementById('aiApiKey') as HTMLInputElement | null)?.value?.trim();
        if (!apiKey) {
            resultEl.textContent = '⚠️ 请先在 AI 面板填入 DeepSeek API Key';
            return;
        }
        resultEl.textContent = '⏳ 正在调用 DeepSeek...';
        // 只发了可编辑部分，发送前把数据结构补上 —— 否则 AI 不知道输出格式
        const res = await debugGenerate(composeSystemPrompt(systemTa.value), userTa.value, apiKey);
        if (res.error) {
            resultEl.textContent = `❌ ${res.error}`;
        } else if (res.notes.length === 0) {
            resultEl.textContent = `⚠️ 解析出 0 个有效音符，未写入乐谱。\n\n——— AI 原始响应 ———\n${res.raw}`;
        } else {
            const written = scoreStore.loadNotes(res.notes, readCurrentOptions().numMeasures);
            lastRaw = res.raw;
            setStatus(`✅ 已生成 ${written} 个音符`, 'success');
            // 不自动关窗：调试面板的价值就在于能当场核对模型到底发了什么。
            // 谱面已经写入（loadNotes 里统一渲染），关窗即可查看。
            resultEl.textContent = `✅ 写入 ${written} 个音符\n\n——— AI 原始响应（可选中复制）———\n${res.raw}`;
        }
    });

    // 保存专业性描述到本地（沿用「修改系统对话」的存储，互相一致）
    modal.querySelector('#pdSave')?.addEventListener('click', async () => {
        await saveCustomSystemPrompt(systemTa.value);
        resultEl.textContent = '💾 系统提示词已保存到本地，后续生成将使用它（数据结构仍由代码追加）。';
    });

    // 恢复默认：清掉自定义 → 显示代码里的默认专业性描述
    modal.querySelector('#pdReset')?.addEventListener('click', async () => {
        await saveCustomSystemPrompt('');
        systemTa.value = DEFAULT_EXPERT_PROMPT;
        resultEl.textContent = '↺ 已恢复默认系统提示词（来自 promptBuilder.ts）。';
    });

    // 用当前乐谱 + 面板选项重新渲染用户提示词（丢弃手改）
    modal.querySelector('#pdRegen')?.addEventListener('click', () => {
        rebuildUser();
        resultEl.textContent = '⟳ 已按当前乐谱/选项重新生成用户提示词。';
    });

    // 复制原始响应：定位「模型没写和声」这类问题时，要的就是这段原文
    modal.querySelector('#pdCopyRaw')?.addEventListener('click', () => {
        if (!lastRaw) {
            resultEl.textContent = '⚠️ 还没有响应可复制，先点「▶ 用上方提示词生成」跑一次。';
            return;
        }
        void navigator.clipboard?.writeText(lastRaw).then(
            () => { resultEl.textContent = `📋 已复制原始响应（${lastRaw.length} 字符）。`; },
            () => { resultEl.textContent = '⚠️ 剪贴板不可用，请手动选中上面的原文复制。'; },
        );
    });
}
