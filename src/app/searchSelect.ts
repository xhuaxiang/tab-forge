/**
 * searchSelect — 搜索型下拉框事件绑定
 */

function closeAllSelects(): void {
    document.querySelectorAll('.search-select.open').forEach(el => el.classList.remove('open'));
}

export function initSearchSelects(): void {
    document.querySelectorAll<HTMLElement>('.search-select').forEach(container => {
        const trigger = container.querySelector('.search-select-trigger') as HTMLElement;
        const searchInput = container.querySelector('.search-input') as HTMLInputElement;
        const optionsList = container.querySelector('.options-list') as HTMLElement;
        if (!trigger) return;

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

        optionsList?.addEventListener('click', (e) => {
            const opt = (e.target as HTMLElement).closest('.option') as HTMLElement;
            if (!opt || opt.classList.contains('no-results')) return;
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
