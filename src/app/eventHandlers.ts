/**
 * eventHandlers — 事件绑定入口
 *
 * 各领域的事件监听器已按职责拆到同目录文件，这里只做启动接线。
 * 不处理 UI 自身逻辑（如和弦网格），只做事件到 store action 的桥接。
 */

import { exportToAsciiTab, exportToJson } from '../core/utils/tabExport.ts';
import { $, setStatus } from './dom.ts';
import { scoreStore } from '../core/stores/scoreStore.ts';
import { initChordGrid } from './input/chordInput.ts';
import { PLAYBACK_ENGINES } from '../core/config.ts';
import { initSearchSelects } from './input/searchSelect.ts';
import { initNoteInput } from './input/noteInput.ts';
import { initMeasureControls } from './controls/measureControls.ts';
import { initAIForm } from './controls/aiForm.ts';
import { syncScoreDefaultsToUI } from './controls/formSync.ts';
import { initScoreControls } from './controls/scoreControls.ts';
import { initPlaybackControls } from './playback/playbackControls.ts';

/**
 * 启动自检：HTML 里写着的取值必须与 TS 常量对得上。
 *
 * 这类耦合断掉时是**静默失效**（下拉选了没反应、回落到别的引擎/渲染器），
 * 比直接报错难查得多——所以在启动时把它变成一条明确的控制台告警。
 */
function warnOnDomValueDrift(): void {
    const engineSel = $('engineSelect') as HTMLSelectElement | null;
    const domEngines = engineSel ? Array.from(engineSel.options).map(o => o.value) : [];
    for (const v of PLAYBACK_ENGINES) {
        if (!domEngines.includes(v)) {
            console.warn(`[TabForge] #engineSelect 缺少取值 "${v}"，与 PLAYBACK_ENGINES 不同步：该引擎无法选中`);
        }
    }
}

export function initEventListeners(): void {
    warnOnDomValueDrift();

    // ============================================================
    // DOM 初始化
    // ============================================================

    // 生成 fretSelect 选项
    const fretOpts = document.getElementById('fretSelect')?.querySelector('.options-list');
    if (fretOpts) {
        fretOpts.innerHTML = '';
        for (let f = 0; f <= 24; f++) {
            const div = document.createElement('div');
            div.className = 'option' + (f === 0 ? ' selected' : '');
            div.dataset.value = String(f);
            div.innerHTML = `第 ${f} 品 <span class="option-note">${f === 0 ? '空弦' : `${f}品`}</span>`;
            fretOpts.appendChild(div);
        }
    }

    // 和弦网格
    initChordGrid();

    // 默认隐藏目标品位输入
    const tfRow = (document.getElementById('targetFret') as HTMLElement)?.closest('.input-group') as HTMLElement;
    if (tfRow) tfRow.style.display = 'none';

    // ============================================================
    // 各领域事件
    // ============================================================

    initSearchSelects();
    initNoteInput();
    initMeasureControls();
    initAIForm();
    syncScoreDefaultsToUI();
    initScoreControls();
    initPlaybackControls();

    // --- Tab 导航 ---
    document.querySelectorAll('.tab-nav button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-nav button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // --- 导出 ---
    $('exportTopBtn')?.addEventListener('click', handleExport);
}

// ============================================================
// 导出 Modal
// ============================================================

function handleExport(): void {
    const ascii = exportToAsciiTab(scoreStore.score);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>📤 导出乐谱</h3>
            <div class="modal-actions">
                <button id="exportAsciiBtn">TAB 文本</button>
                <button id="exportJsonBtn">JSON</button>
                <button id="copyBtn" class="btn-copy">📋 复制</button>
            </div>
            <textarea class="modal-textarea" id="exportOutput" readonly>${ascii}</textarea>
            <div class="modal-footer">
                <button id="closeExportBtn">关闭</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const ta = modal.querySelector('#exportOutput') as HTMLTextAreaElement;
    modal.querySelector('#exportAsciiBtn')?.addEventListener('click', () => {
        ta.value = exportToAsciiTab(scoreStore.score);
    });
    modal.querySelector('#exportJsonBtn')?.addEventListener('click', () => {
        ta.value = exportToJson(scoreStore.score);
    });
    modal.querySelector('#copyBtn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(ta.value)
            .then(() => setStatus('已复制', 'success'))
            .catch(() => setStatus('复制失败', 'error'));
    });
    modal.querySelector('#closeExportBtn')?.addEventListener('click', () => document.body.removeChild(modal));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });

}
