/**
 * TabForge Popup — 入口
 *
 * 负责初始化所有模块。
 * 不包含具体业务逻辑，只做组装和启动。
 */

import { $, setStatus, render, getCanvasRenderer, setRenderMode } from './app/state.ts';
import { scoreStore } from './stores/scoreStore.ts';
import { initEventListeners } from './app/eventHandlers.ts';

// ============================================================
// 初始化
// ============================================================

function init(): void {
    initEventListeners();
    // scoreStore 数据变更自动触发渲染（集中式，eventHandlers 不再手动 render）
    scoreStore.setOnChange(() => render());
    // 默认 alphaTab 渲染
    void setRenderMode('alphaTab', true);

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

