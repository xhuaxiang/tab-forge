/**
 * TabForge Popup — 入口
 *
 * 负责初始化所有模块。
 * 不包含具体业务逻辑，只做组装和启动。
 */

import { $, setStatus, initCanvasRenderer, render, getCanvasRenderer } from './state.ts';
import { initEventListeners } from './eventHandlers.ts';

// ============================================================
// 初始化
// ============================================================

function init(): void {
    initEventListeners();
    initCanvasRenderer();
    render();

    const container = $('tabContent')!;
    const ro = new ResizeObserver(() => {
        const w = container.clientWidth || 748;
        const h = container.clientHeight || 320;
        const cr = getCanvasRenderer();
        if (cr) {
            cr.setSize(w, h);
            render();
        }
    });
    ro.observe(container);

    setStatus('就绪 — 点击「+ 小节」开始创建吉他六线谱', 'info');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

