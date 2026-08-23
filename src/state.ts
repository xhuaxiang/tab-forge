/**
 * state — 应用状态与渲染入口
 *
 * 管理 Canvas 渲染器实例和通用工具函数。
 * 状态数据已迁移到 stores/
 */

import { TabCanvasRenderer, createTabCanvas } from './canvas/index.ts';
import { scoreStore } from './stores/scoreStore.ts';
// 仅类型导入：避免把 alphaTab 核心拖进主 bundle（运行时按需动态 import）
import type { AlphaTabRenderer } from './alphaTab/alphaTabRenderer.ts';
// ============================================================
// 渲染器实例与切换
// ============================================================

export type RenderMode = 'canvas' | 'alphaTab';

let canvasRenderer: TabCanvasRenderer | null = null;
let alphaTabRenderer: AlphaTabRenderer | null = null;
let renderMode: RenderMode = 'alphaTab'; // 默认 alphaTab 渲染

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
        const { AlphaTabRenderer } = await import('./alphaTab/alphaTabRenderer.ts');
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
// DOM 工具
// ============================================================

/** 简写 DOM 选择器 */
export function $(id: string): HTMLElement | null {
    return document.getElementById(id);
}

const statusBar = $('statusBar')!;

/** 设置状态栏消息 */
export function setStatus(msg: string, type: 'info' | 'success' | 'error' = 'info'): void {
    statusBar.textContent = msg;
    statusBar.className = 'status-bar';
    if (type) statusBar.classList.add(type);
}

// ============================================================
// Canvas 渲染
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
}

/** 获取当前 Canvas 渲染器（外部只读） */
export function getCanvasRenderer(): TabCanvasRenderer | null {
    return canvasRenderer;
}

// ============================================================
// 工具函数
// ============================================================

/** 获取 Search-Select 组件的选中值 */
export function getSearchSelectValue(id: string): number {
    const val = document.getElementById(id)?.dataset.value;
    if (val === undefined || val === '') return 1;
    return Number(val);
}

/** 时值名称 */
export function durationName(d: number): string {
    const m: Record<number, string> = {
        1: '全音符',
        0.5: '二分音符',
        0.25: '四分音符',
        0.125: '八分音符',
        0.0625: '十六分',
        0.03125: '三十二分',
    };
    return m[d] || `${d}拍`;
}

