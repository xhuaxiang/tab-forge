/**
 * render — 渲染编排
 *
 * 只管理 alphaTab（专业，懒加载）渲染器实例。
 * 对外暴露 render() / renderHighlight()，由 popup.ts 注入到 scoreStore 的
 * onChange / onSelectChange，实现「数据变更 → 刷渲染器」。
 * DOM 助手（$ / setStatus）在 dom.ts；纯工具在 core/utils，本文件不混装。
 */

import { scoreStore } from '../../core/stores/scoreStore.ts';
import { $ } from '../dom.ts';
import { syncMeasureNav } from './measureNav.ts';
// 仅类型导入：避免把 alphaTab 核心拖进主 bundle（运行时按需动态 import）
import type { AlphaTabRenderer } from '../../features/alphaTab/alphaTabRenderer.ts';

let alphaTabRenderer: AlphaTabRenderer | null = null;

/** 挂载渲染器（启动时调用一次；alphaTab 核心按需动态加载） */
export async function initRenderer(): Promise<void> {
    const container = $('alphaTabContainer')!;
    alphaTabRenderer?.dispose();
    const { AlphaTabRenderer } = await import('../../features/alphaTab/alphaTabRenderer.ts');
    alphaTabRenderer = new AlphaTabRenderer();
    await alphaTabRenderer.mount(container);
    render();
}

/** 用当前乐谱刷新渲染器 */
export function render(): void {
    alphaTabRenderer?.render(scoreStore.score);
    renderHighlight();
}

/** 刷新「选中小节」高亮（alphaTab 覆盖框）；未选中传 -1 隐藏 */
export function renderHighlight(): void {
    alphaTabRenderer?.setSelectedMeasure(scoreStore.selectedMeasure ?? -1);
    syncMeasureNav();
}
