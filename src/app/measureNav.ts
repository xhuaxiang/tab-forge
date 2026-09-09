/**
 * measureNav — 小节导航（选中小节）
 *
 * 渲染器无关的「选中小节」入口：◀ ▶ 步进 + 小节数字 chips。
 * 点击通过 scoreStore.selectMeasure 切换选中（走轻量 onSelectChange，
 * 由 state 负责刷新渲染器高亮）。DOM 自身由 refreshMeasureNav 从 store 重建。
 */

import { scoreStore } from '../core/stores/scoreStore.ts';

let inited = false;

/** 绑定 ◀ ▶ 与 chips 的点击（只做一次） */
export function initMeasureNav(): void {
    if (inited) return;
    inited = true;

    document.getElementById('navMeasurePrev')?.addEventListener('click', () => {
        scoreStore.selectMeasure(scoreStore.activeMeasureIndex() - 1);
    });
    document.getElementById('navMeasureNext')?.addEventListener('click', () => {
        scoreStore.selectMeasure(scoreStore.activeMeasureIndex() + 1);
    });
    document.getElementById('navMeasureChips')?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
        if (!btn) return;
        // 再点一次已选中的数字 → 取消选中（回到默认末尾目标）
        if (btn.classList.contains('active')) scoreStore.selectMeasure(null);
        else scoreStore.selectMeasure(Number(btn.dataset.index));
    });
}

/** 懒初始化 + 立即刷新（由 state.render/renderHighlight 统一调用，popup 无需单独接线） */
export function syncMeasureNav(): void {
    initMeasureNav();
    refreshMeasureNav();
}

/** 依据 scoreStore 重建导航 DOM（目标小节 / 选中态 / chips） */
export function refreshMeasureNav(): void {
    const total = scoreStore.score.measures.length;
    const sel = scoreStore.selectedMeasure; // null = 未选中（默认末尾）
    const eff = sel === null ? Math.max(total - 1, 0) : Math.min(Math.max(sel, 0), Math.max(total - 1, 0));

    const root = document.getElementById('measureNav');
    if (root) root.style.display = total > 0 ? '' : 'none';

    const label = document.getElementById('navMeasureLabel');
    if (label) {
        label.title = '目标小节：未选中时添加操作落到末尾小节；点击数字/谱面小节即可选中作为目标';
        label.textContent = total > 0
            ? (sel === null ? `小节 ${eff + 1}/${total} · 默认` : `小节 ${sel + 1}/${total} · 已选`)
            : '小节 —';
    }

    const prev = document.getElementById('navMeasurePrev') as HTMLButtonElement | null;
    const next = document.getElementById('navMeasureNext') as HTMLButtonElement | null;
    if (prev) prev.disabled = total === 0 || eff <= 0;
    if (next) next.disabled = total === 0 || eff >= total - 1;

    const chips = document.getElementById('navMeasureChips');
    if (!chips) return;
    let html = '';
    for (let i = 0; i < total; i++) {
        html += `<button type="button" class="measure-chip${sel === i ? ' active' : ''}" data-index="${i}">${i + 1}</button>`;
    }
    if (chips.innerHTML !== html) chips.innerHTML = html;
}
