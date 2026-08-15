/**
 * state — 应用状态与渲染入口
 *
 * 管理 Canvas 渲染器实例和通用工具函数。
 * 状态数据已迁移到 stores/
 */

import { TabCanvasRenderer, createTabCanvas } from './canvas/index.ts';
import { scoreStore } from './stores/scoreStore.ts';
// ============================================================
// 渲染器实例
// ============================================================

let canvasRenderer: TabCanvasRenderer | null = null;

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
    if (!canvasRenderer) initCanvasRenderer();
    canvasRenderer!.render(scoreStore.score);
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

