/**
 * render — 渲染编排（渲染器协调层）
 *
 * 管理 Canvas（自研）与 alphaTab（专业，懒加载）两个渲染器实例与切换。
 * 对外暴露 render() / renderHighlight()，由 popup.ts 注入到 scoreStore 的
 * onChange / onSelectChange，实现「数据变更 → 刷对应渲染器」。
 * DOM 助手（$ / setStatus）在 dom.ts；纯工具在 core/utils，本文件不混装。
 */

import { scoreStore } from '../core/stores/scoreStore.ts';
import { DEFAULT_RENDER_MODE } from '../core/config.ts';
import { $ } from './dom.ts';
import { syncMeasureNav } from './measureNav.ts';
import { TabCanvasRenderer, createTabCanvas } from '../features/canvas/index.ts';
// 仅类型导入：避免把 alphaTab 核心拖进主 bundle（运行时按需动态 import）
import type { AlphaTabRenderer } from '../features/alphaTab/alphaTabRenderer.ts';

// ============================================================
// 渲染器实例与切换
// ============================================================

export type RenderMode = 'canvas' | 'alphaTab';

let canvasRenderer: TabCanvasRenderer | null = null;
let alphaTabRenderer: AlphaTabRenderer | null = null;
let renderMode: RenderMode = DEFAULT_RENDER_MODE;

/** 当前渲染模式 */
export function getRenderMode(): RenderMode {
    return renderMode;
}

/** 切换渲染器：canvas（自研）↔ alphaTab（专业渲染，懒加载）
 *
 * 两个渲染器各自有独立容器：
 * - #tabContent        自研 Canvas 六线谱
 * - #alphaTabContainer alphaTab 专业渲染
 * 切换时显示目标容器、隐藏另一个（swiper 式两块互切）。
 */
export async function setRenderMode(mode: RenderMode, force = false): Promise<void> {
    if (!force && mode === renderMode) return;
    renderMode = mode;
    const tabContainer = $('tabContent')!;
    const alphaContainer = $('alphaTabContainer')!;

    if (mode === 'alphaTab') {
        tabContainer.style.display = 'none';
        alphaContainer.style.display = 'block';
        canvasRenderer = null;
        alphaTabRenderer?.dispose();
        const { AlphaTabRenderer } = await import('../features/alphaTab/alphaTabRenderer.ts');
        alphaTabRenderer = new AlphaTabRenderer();
        await alphaTabRenderer.mount(alphaContainer);
        render();
    } else {
        alphaContainer.style.display = 'none';
        tabContainer.style.display = 'block';
        alphaTabRenderer?.dispose();
        alphaTabRenderer = null;
        initCanvasRenderer();
        render();
    }
}

// ============================================================
// 渲染入口
// ============================================================

export function initCanvasRenderer(): void {
    const container = $('tabContent')!;
    const w = container.clientWidth || 748;
    const h = container.clientHeight || 320;
    if (!canvasRenderer) {
        canvasRenderer = createTabCanvas(container, w, h);
    } else {
        canvasRenderer.setSize(w, h);
    }
}

export function render(): void {
    if (renderMode === 'alphaTab') {
        alphaTabRenderer?.render(scoreStore.score);
    } else {
        if (!canvasRenderer) initCanvasRenderer();
        canvasRenderer!.render(scoreStore.score);
    }
    renderHighlight();
}

/** 按当前渲染模式刷新「选中小节」高亮（alphaTab 覆盖框 / canvas 底色）；未选中传 -1 隐藏 */
export function renderHighlight(): void {
    const sel = scoreStore.selectedMeasure ?? -1;
    if (renderMode === 'alphaTab') {
        alphaTabRenderer?.setSelectedMeasure(sel);
    } else {
        canvasRenderer?.setSelectedMeasure(sel);
    }
    syncMeasureNav();
}

/** 获取当前 Canvas 渲染器（外部只读） */
export function getCanvasRenderer(): TabCanvasRenderer | null {
    return canvasRenderer;
}
