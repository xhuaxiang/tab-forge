/**
 * promptDebug — AI 即兴 Prompt 调试面板（供调参 / 交接他人使用）
 *
 * 同时展示并编辑两段最终会发给 DeepSeek 的提示词：
 *   ① 系统提示词 System Prompt —— 角色 / 格式 / 规则
 *   ② 用户提示词 User Prompt   —— 每次生成的具体指令（默认由 buildUserPrompt 生成，可临时改）
 * 提供「生成测试」直接调用并展示 AI 原始响应，方便快速迭代。
 *
 * 找到合适的两段后，回写到 src/features/ai/promptBuilder.ts：
 *   SYSTEM_PROMPT 常量（①）+ buildUserPrompt 函数（②）。
 */

import { scoreStore } from '../../core/stores/scoreStore.ts';
import { IMPROV_CONFIG } from '../../core/config.ts';
import { SYSTEM_PROMPT, buildUserPrompt, type GenerationOptions } from './promptBuilder.ts';
import { getEffectiveSystemPrompt, saveCustomSystemPrompt } from './systemPromptEditor.ts';
import { getApiKey, debugGenerate } from './aiService.ts';
import { setStatus } from '../../app/state.ts';

/** 从 AI 面板控件读取当前生成选项 */
function readCurrentOptions(): GenerationOptions {
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
    };
}

/** 打开 Prompt 调试弹窗 */
export function openPromptDebug(): void {
    void (async () => {
        const system = await getEffectiveSystemPrompt();
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
                改上面两段提示词 → 点「▶ 用上方提示词生成」→ 出谱并自动关窗。
                找到合适组合后，把内容回写进 <code>src/features/ai/promptBuilder.ts</code>（SYSTEM_PROMPT 常量 + buildUserPrompt 函数）。
            </p>

            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:2px;">① 系统提示词（System Prompt）</div>
            <p style="font-size:11px;color:var(--text-muted);margin:0 0 4px;line-height:1.5;">
                给 AI 的「角色与规则」：告诉它你是谁、输出格式、节奏/旋律/技法要求。影响 AI「怎么想、怎么生成」。
                点「保存系统提示词」后对所有生成生效（存本地，覆盖代码默认）。
            </p>
            <textarea class="modal-textarea" id="pdSystem" style="min-height:140px;font-size:13px;line-height:1.6;color:var(--text-primary);"></textarea>

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

    const close = (): void => { document.body.removeChild(modal); };
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
        const res = await debugGenerate(systemTa.value, userTa.value, apiKey);
        if (res.error) {
            resultEl.textContent = `❌ ${res.error}`;
        } else if (res.notes.length === 0) {
            resultEl.textContent = `⚠️ 解析出 0 个有效音符，未写入乐谱。\n\n——— AI 原始响应 ———\n${res.raw}`;
        } else {
            const written = scoreStore.loadNotes(res.notes, readCurrentOptions().numMeasures);
            // 成功：应用乐谱后自动关窗展示谱面
            setStatus(`✅ 已生成 ${written} 个音符`, 'success');
            close();
        }
    });

    // 保存系统提示词到本地（沿用「修改系统对话」的存储，互相一致）
    modal.querySelector('#pdSave')?.addEventListener('click', async () => {
        await saveCustomSystemPrompt(systemTa.value);
        resultEl.textContent = '💾 系统提示词已保存到本地，后续生成将使用它。';
    });

    // 恢复默认：清掉自定义 → 显示代码里的 SYSTEM_PROMPT
    modal.querySelector('#pdReset')?.addEventListener('click', async () => {
        await saveCustomSystemPrompt('');
        systemTa.value = SYSTEM_PROMPT;
        resultEl.textContent = '↺ 已恢复默认系统提示词（来自 promptBuilder.ts 的 SYSTEM_PROMPT）。';
    });

    // 用当前乐谱 + 面板选项重新渲染用户提示词（丢弃手改）
    modal.querySelector('#pdRegen')?.addEventListener('click', () => {
        userTa.value = buildUserPrompt(readCurrentOptions());
        resultEl.textContent = '⟳ 已按当前乐谱/选项重新生成用户提示词。';
    });
}
