/**
 * dom — 通用 DOM / UI 助手
 *
 * 只放碰 DOM 的小工具（选择器 / 状态栏 / Search-Select 取值）。
 * 不依赖业务模块；纯映射类工具放 core/utils，这里不留无 DOM 的逻辑。
 */

import { t, type MessageKey, type MessageParams } from '../core/i18n/index.ts';

export type StatusType = 'info' | 'success' | 'error';

/** 简写 DOM 选择器 */
export function $(id: string): HTMLElement | null {
    return document.getElementById(id);
}

const statusBar = $('statusBar')!;

/** 最近一次由 key 设置的状态；普通 setStatus 会清空，切换语言时不再重放 */
let keyedStatus: { key: MessageKey; params?: MessageParams; type: StatusType } | null = null;

function writeStatus(msg: string, type: StatusType): void {
    statusBar.textContent = msg;
    statusBar.className = 'status-bar';
    if (type) statusBar.classList.add(type);
}

/** 设置状态栏消息（动态文本；切换语言后不重放，下次事件会覆盖） */
export function setStatus(msg: string, type: StatusType = 'info'): void {
    keyedStatus = null;
    writeStatus(msg, type);
}

/** 用文案 key 设置状态栏；切换语言时可按 key 重放 */
export function setStatusT(key: MessageKey, params?: MessageParams, type: StatusType = 'info'): void {
    keyedStatus = { key, params, type };
    writeStatus(t(key, params), type);
}

/** 切换语言后刷新状态栏：keyed 状态按新语言重放，否则回到「就绪」 */
export function refreshStatus(): void {
    if (keyedStatus) {
        writeStatus(t(keyedStatus.key, keyedStatus.params), keyedStatus.type);
        return;
    }
    writeStatus(t('status.ready'), 'info');
}

/** 以 Blob 触发浏览器下载（临时 <a>，用完即回收 object URL） */
export function downloadBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        // 延迟回收：立即 revoke 在部分浏览器会让下载中断
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

/** 获取 Search-Select 组件的选中值 */
export function getSearchSelectValue(id: string): number {
    const val = document.getElementById(id)?.dataset.value;
    if (val === undefined || val === '') return 1;
    return Number(val);
}

/**
 * 读取多选值（按数值升序）。
 * 空/非数字 data-value 一律忽略，避免 `Number('') === 0` 混进结果。
 */
export function readSearchSelectValues(container: HTMLElement): number[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.option.selected'))
        .map(o => o.dataset.value ?? '')
        .filter(v => v !== '')
        .map(Number)
        .filter(v => Number.isFinite(v))
        .sort((a, b) => a - b);
}

/** 读取 Search-Select 多选组件的选中值（按数值升序，空选返回 []） */
export function getSearchSelectValues(id: string): number[] {
    const container = document.getElementById(id);
    return container ? readSearchSelectValues(container) : [];
}

/** 解析 `data-max-selected`；未设置/非法返回 null */
export function getSearchSelectLimit(container: HTMLElement): number | null {
    const raw = container.dataset.maxSelected;
    if (raw === undefined || raw === '') return null;
    const max = Number(raw);
    return Number.isFinite(max) && max > 0 ? max : null;
}

/**
 * 写回多选值：同步 `.selected`、`data-value`（保留首项，兼容单选读取）、
 * trigger 文本与上限禁用态。搜索/回填共用这一处，别在调用处手写。
 */
export function writeSearchSelectValues(container: HTMLElement, values: number[]): void {
    const sorted = Array.from(new Set(values.filter(v => Number.isFinite(v)))).sort((a, b) => a - b);
    const wanted = new Set(sorted.map(String));
    container.querySelectorAll<HTMLElement>('.option').forEach(o =>
        o.classList.toggle('selected', wanted.has(o.dataset.value ?? '')));
    // data-value 保留首项：单选读取与旧逻辑兼容
    container.dataset.value = sorted.length > 0 ? String(sorted[0]) : '';
    const tv = container.querySelector('.trigger-value');
    if (tv) tv.textContent = sorted.join(',') || '0';
    syncSearchSelectLimit(container);
}

/**
 * 按 `data-max-selected` 同步多选下拉的禁用态：
 * 达到上限后，未选中的选项加 `.disabled`（点击无效），移除上限时全部恢复。
 * 上限为 1 时不禁用其余项——按单选语义允许点另一项直接改选，
 * 否则用户选中 H/P/S 后就再也换不了弦。
 */
export function syncSearchSelectLimit(container: HTMLElement): void {
    const optionsList = container.querySelector('.options-list');
    if (!optionsList) return;
    const max = getSearchSelectLimit(container);
    const options = optionsList.querySelectorAll<HTMLElement>('.option');

    if (max === null || max <= 1) {
        options.forEach(o => o.classList.remove('disabled'));
        return;
    }
    const selectedCount = optionsList.querySelectorAll('.option.selected').length;
    options.forEach(o =>
        o.classList.toggle('disabled', selectedCount >= max && !o.classList.contains('selected')));
}
