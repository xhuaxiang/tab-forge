/**
 * improvOptions — 即兴表单下拉的公共填充逻辑。
 *
 * AI 与本地生成共用同一套 select 结构；选项值/标签由各自 config 提供，
 * 这里只负责 DOM 写入，避免两处各写一份 fillSelect 后悄悄漂移。
 */

import type { ImprovSelectOption } from '../../core/config.ts';

export function fillSelectOptions(
    id: string,
    options: ReadonlyArray<ImprovSelectOption>,
    defaultVal: string,
    opts: { preferCurrent?: boolean } = {},
): void {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) return;
    // 语言切换重建时保留当前选择；首屏或无匹配值仍落回默认
    const current = select.value;
    const selected = opts.preferCurrent && options.some(option => option.value === current)
        ? current
        : defaultVal;
    select.innerHTML = '';
    for (const option of options) {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        if (option.value === selected) element.selected = true;
        select.appendChild(element);
    }
}

export function fillNumberSelect(
    id: string,
    values: readonly number[],
    defaultVal: number,
    opts: { preferCurrent?: boolean } = {},
): void {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) return;
    // 语言切换重建时保留当前手选的小节数；首屏无有效旧值时落回默认
    const current = Number(select.value);
    const selected = opts.preferCurrent && values.includes(current) ? current : defaultVal;
    select.innerHTML = '';
    for (const value of values) {
        const element = document.createElement('option');
        element.value = String(value);
        element.textContent = String(value);
        if (value === selected) element.selected = true;
        select.appendChild(element);
    }
}
