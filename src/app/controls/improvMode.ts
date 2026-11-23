/**
 * improvMode — 顶部「本地即兴 / AI 即兴」切换。
 *
 * 只负责两块面板的显隐；生成逻辑仍在各自 form 里。
 * AI 即兴暂缓上线：选中时只提示并回落到本地，不进入不可用面板。
 */

import { setStatusT } from '../dom.ts';

type ImprovMode = 'local' | 'ai';

const PANELS: ReadonlyArray<readonly [ImprovMode, string]> = [
    ['local', 'localImprovPanel'],
    ['ai', 'aiSettingsPanel'],
];

function isImprovMode(value: string): value is ImprovMode {
    return value === 'local' || value === 'ai';
}

function applyImprovMode(mode: ImprovMode): void {
    for (const [panelMode, id] of PANELS) {
        const panel = document.getElementById(id) as HTMLDetailsElement | null;
        if (!panel) continue;

        const visible = panelMode === mode;
        panel.style.display = visible ? '' : 'none';
        if (visible) panel.open = true;
    }
}

export function initImprovModeSwitch(): void {
    const select = document.getElementById('improvModeSelect') as HTMLSelectElement | null;
    if (!select) return;

    // HTML 的 selected 只是初值；这里按实际 value 统一应用，默认回落本地即兴。
    // AI 即兴暂缓上线，初始值也一并回落到本地。
    const initial = select.value === 'ai' ? 'local' : (isImprovMode(select.value) ? select.value : 'local');
    select.value = initial;
    applyImprovMode(initial);

    select.addEventListener('change', () => {
        if (select.value === 'ai') {
            // AI 即兴暂缓上线：提示后把下拉复位，本地面板保持可见
            select.value = 'local';
            applyImprovMode('local');
            setStatusT('improv.aiSoon', undefined, 'info');
            return;
        }
        const mode = isImprovMode(select.value) ? select.value : 'local';
        applyImprovMode(mode);
    });
}
