/**
 * dom — 通用 DOM / UI 助手
 *
 * 只放碰 DOM 的小工具（选择器 / 状态栏 / Search-Select 取值）。
 * 不依赖业务模块；纯映射类工具放 core/utils，这里不留无 DOM 的逻辑。
 */

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

/** 获取 Search-Select 组件的选中值 */
export function getSearchSelectValue(id: string): number {
    const val = document.getElementById(id)?.dataset.value;
    if (val === undefined || val === '') return 1;
    return Number(val);
}
