/**
 * TabForge Popup — 入口
 *
 * 负责初始化所有模块。
 * 不包含具体业务逻辑，只做组装和启动。
 * 语言必须在 initEventListeners 之前确定：动态生成的下拉/按钮文案才能一次成型。
 */

import { setStatusT } from './app/dom.ts';
import { initRenderer, initDisplayModeControl, render, renderHighlight } from './app/render/render.ts';
import { scoreStore } from './core/stores/scoreStore.ts';
import { initEventListeners } from './app/eventHandlers.ts';
import { initI18n } from './app/i18n.ts';

// ============================================================
// 初始化
// ============================================================

async function init(): Promise<void> {
    try {
        // 失败时保持 core 默认 zh-CN，界面仍可正常启动
        await initI18n();
    } catch (error) {
        console.error('[TabForge] 界面语言初始化失败，回退中文', error);
    }

    try {
        initEventListeners();
        // scoreStore 数据变更自动触发渲染（集中式，eventHandlers 不再手动 render）
        scoreStore.setOnChange(() => {
            render();
        });
        // 选中小节变化只刷新高亮与导航（不整谱重渲染）
        scoreStore.setOnSelectChange(() => {
            renderHighlight();
        });
        // 谱面显示模式（六线谱 / 五线+六线）；必须在挂载渲染器前接线，切换时才不会丢
        initDisplayModeControl();

        setStatusT('status.ready');
    } finally {
        // 语言文案就绪（或回退完成）后再显示页面，避免中文闪现
        document.documentElement.classList.remove('i18n-loading');
    }

    // 挂载 alphaTab 渲染器（异步动态 import，不阻塞首屏）
    void initRenderer();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        void init();
    });
} else {
    void init();
}
