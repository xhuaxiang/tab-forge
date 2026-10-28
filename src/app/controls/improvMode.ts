/**
 * improvMode — 顶部「本地即兴 / AI 即兴」切换。
 *
 * 只负责两块面板的显隐；生成逻辑仍在各自 form 里。
 */

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
    const initial = isImprovMode(select.value) ? select.value : 'local';
    select.value = initial;
    applyImprovMode(initial);

    select.addEventListener('change', () => {
        const mode = isImprovMode(select.value) ? select.value : 'local';
        applyImprovMode(mode);
    });
}
