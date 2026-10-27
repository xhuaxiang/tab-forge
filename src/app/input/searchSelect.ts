/**
 * searchSelect — 搜索型下拉框事件绑定
 *
 * 两种模式：
 * - 单选（默认）：点一项即选中并关闭
 * - 多选（`data-multi="true"`）：点一项切换选中、面板保持打开；至少保留一项。
 *   `data-max-selected="N"`（N>1）限制最多选 N 项，达到上限后其余项置灰且点击无效；
 *   N=1 时按单选语义：点另一项直接改选（不禁用其余项，否则选错弦后无法更换）。
 */

import { getSearchSelectLimit, readSearchSelectValues, writeSearchSelectValues, syncSearchSelectLimit } from '../dom.ts';

function closeAllSelects(): void {
    document.querySelectorAll('.search-select.open').forEach(el => el.classList.remove('open'));
}

export function initSearchSelects(): void {
    document.querySelectorAll<HTMLElement>('.search-select').forEach(container => {
        const trigger = container.querySelector('.search-select-trigger') as HTMLElement;
        const searchInput = container.querySelector('.search-input') as HTMLInputElement;
        const optionsList = container.querySelector('.options-list') as HTMLElement;
        if (!trigger || !optionsList) return;

        const isMulti = container.dataset.multi === 'true';
        syncSearchSelectLimit(container);

        // 面板内部点击（搜索框、滚动条等）不应冒泡到 document 把面板关掉
        container.addEventListener('click', (e) => e.stopPropagation());

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = container.classList.contains('open');
            closeAllSelects();
            if (!wasOpen) {
                container.classList.add('open');
                setTimeout(() => searchInput?.focus(), 50);
            }
        });

        searchInput?.addEventListener('input', () => {
            const q = searchInput.value.toLowerCase();
            const opts = optionsList.querySelectorAll('.option');
            let has = false;
            opts.forEach(o => {
                const m = (o.textContent || '').toLowerCase().includes(q);
                o.classList.toggle('hidden', !m);
                if (m) has = true;
            });
            const old = optionsList.querySelector('.no-results');
            if (old) old.remove();
            if (!has) {
                const nr = document.createElement('div');
                nr.className = 'no-results';
                nr.textContent = '无匹配';
                optionsList.appendChild(nr);
            }
        });

        optionsList.addEventListener('click', (e) => {
            // 多选时面板要保持打开；单选的关闭在自己分支里做
            e.stopPropagation();
            const opt = (e.target as HTMLElement).closest('.option') as HTMLElement | null;
            if (!opt || opt.classList.contains('no-results')) return;

            if (isMulti) {
                if (opt.classList.contains('disabled')) return;
                const limit = getSearchSelectLimit(container);
                const selected = optionsList.querySelectorAll('.option.selected');

                if (opt.classList.contains('selected')) {
                    if (selected.length <= 1) return; // 至少保留一根
                    opt.classList.remove('selected');
                } else if (limit === 1) {
                    // 单选上限：点另一项直接改选，避免第一根被锁死
                    selected.forEach(o => o.classList.remove('selected'));
                    opt.classList.add('selected');
                } else {
                    if (limit !== null && selected.length >= limit) return;
                    opt.classList.add('selected');
                }
                writeSearchSelectValues(container, readSearchSelectValues(container));
                // 继续选下一项：清掉搜索过滤，保持面板打开
                if (searchInput) searchInput.value = '';
                optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('hidden'));
                return;
            }

            const val = opt.dataset.value;
            optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            const tv = container.querySelector('.trigger-value');
            if (tv) tv.textContent = val || '0';
            container.dataset.value = val || '0';
            container.classList.remove('open');
            if (searchInput) searchInput.value = '';
            optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('hidden'));
        });
    });

    document.addEventListener('click', closeAllSelects);
}
