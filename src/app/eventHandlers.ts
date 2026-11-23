/**
 * eventHandlers — 事件绑定入口
 *
 * 各领域的事件监听器已按职责拆到同目录文件，这里只做启动接线。
 * 不处理 UI 自身逻辑（如和弦网格），只做事件到 store action 的桥接。
 */

import { exportToAsciiTab } from '../core/utils/tabExport.ts';
// 未实现文件下载/导入，入口先隐藏（TODO 1.2）
// import { exportToJson } from '../core/utils/tabExport.ts';
import { exportToGp, gpExportFileName } from '../features/alphaTab/gpExport.ts';
import { $, setStatusT, downloadBlob } from './dom.ts';
import { t } from '../core/i18n/index.ts';
import { scoreStore } from '../core/stores/scoreStore.ts';
import { initChordGrid } from './input/chordInput.ts';
import { PLAYBACK_ENGINES, DISPLAY_MODES } from '../core/config.ts';
import { initSearchSelects } from './input/searchSelect.ts';
import { initNoteInput } from './input/noteInput.ts';
import { initMeasureControls } from './controls/measureControls.ts';
import { initAIForm } from './controls/aiForm.ts';
import { initLocalImprovForm } from './controls/localImprovForm.ts';
import { initImprovModeSwitch } from './controls/improvMode.ts';
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

    const displaySel = $('displayModeSelect') as HTMLSelectElement | null;
    const domModes = displaySel ? Array.from(displaySel.options).map(o => o.value) : [];
    for (const v of DISPLAY_MODES) {
        if (!domModes.includes(v)) {
            console.warn(`[TabForge] #displayModeSelect 缺少取值 "${v}"，与 DISPLAY_MODES 不同步：该显示模式无法选中`);
        }
    }
}

export function initEventListeners(): void {
    warnOnDomValueDrift();

    // ============================================================
    // DOM 初始化
    // ============================================================

    // 生成 fretSelect 选项（语言切换时由 refreshFretOptions 重建）
    refreshFretOptions();

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
    initLocalImprovForm();
    initImprovModeSwitch();
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

/**
 * 重建 0–24 品选项：按 `#fretSelect` 当前 data-value 恢复选中。
 * 事件走列表委托（searchSelect），重建选项不会丢监听。
 */
export function refreshFretOptions(): void {
    const container = document.getElementById('fretSelect');
    const list = container?.querySelector('.options-list');
    if (!container || !list) return;

    const current = container.dataset.value || '0';
    list.textContent = '';
    for (let f = 0; f <= 24; f++) {
        const option = document.createElement('div');
        option.className = 'option' + (String(f) === current ? ' selected' : '');
        option.dataset.value = String(f);
        option.append(`${t('fret.option', { fret: f })} `);
        const note = document.createElement('span');
        note.className = 'option-note';
        note.textContent = f === 0 ? t('fret.noteOpen') : t('fret.noteFret', { fret: f });
        option.appendChild(note);
        list.appendChild(option);
    }
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
            <h3>${t('export.title')}</h3>
            <div class="modal-actions">
                <!-- 未实现文件下载/导入，先隐藏（TODO 1.2）
                <button id="exportAsciiBtn">TAB 文本</button>
                <button id="exportJsonBtn">JSON</button>
                -->
                <button id="exportGpBtn">Guitar Pro (.gp)</button>
                <button id="copyBtn" class="btn-copy">${t('export.copy')}</button>
            </div>
            <textarea class="modal-textarea" id="exportOutput" readonly>${ascii}</textarea>
            <div class="modal-footer">
                <button id="closeExportBtn">${t('common.close')}</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const ta = modal.querySelector('#exportOutput') as HTMLTextAreaElement;
    // 未实现文件下载/导入，入口先隐藏（TODO 1.2）
    // modal.querySelector('#exportAsciiBtn')?.addEventListener('click', () => {
    //     ta.value = exportToAsciiTab(scoreStore.score);
    // });
    // modal.querySelector('#exportJsonBtn')?.addEventListener('click', () => {
    //     ta.value = exportToJson(scoreStore.score);
    // });
    modal.querySelector('#exportGpBtn')?.addEventListener('click', () => {
        try {
            const bytes = exportToGp(scoreStore.score);
            // 显式拷贝为 ArrayBuffer：新版 TS lib.dom 不接受 Uint8Array<ArrayBufferLike> 作为 BlobPart
            const buffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(buffer).set(bytes);
            downloadBlob(
                gpExportFileName(scoreStore.score),
                new Blob([buffer], { type: 'application/octet-stream' }),
            );
            setStatusT('export.status.gpExported', undefined, 'success');
        } catch (e) {
            console.error('[TabForge] Guitar Pro 导出失败', e);
            setStatusT('export.status.gpFailed', undefined, 'error');
        }
    });
    modal.querySelector('#copyBtn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(ta.value)
            .then(() => setStatusT('export.status.copied', undefined, 'success'))
            .catch(() => setStatusT('export.status.copyFailed', undefined, 'error'));
    });
    modal.querySelector('#closeExportBtn')?.addEventListener('click', () => document.body.removeChild(modal));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });

}
