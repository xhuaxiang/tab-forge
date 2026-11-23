/**
 * storage — 浏览器本地字符串存储（通用，碰副作用）。
 *
 * 扩展内走 `chrome.storage.local`，网页走 `localStorage`；调用方只关心
 * 「按 key 读写字符串」。放 features 根而不是 app：app 与各 feature 共用
 * 这一份实现，同时避免 features → app 的反向依赖。
 *
 * 读失败返回 null；写失败统一告警、不向上抛（没有调用方依赖 reject）。
 */

function isChromeStorage(): boolean {
    return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export async function readStorage(key: string): Promise<string | null> {
    if (isChromeStorage()) {
        try {
            const result = await chrome.storage.local.get(key);
            const value = result[key];
            return typeof value === 'string' && value !== '' ? value : null;
        } catch {
            return null;
        }
    }
    try {
        return localStorage.getItem(key) || null;
    } catch {
        return null;
    }
}

export async function writeStorage(key: string, value: string): Promise<void> {
    if (isChromeStorage()) {
        try {
            await chrome.storage.local.set({ [key]: value });
        } catch (error) {
            console.warn(`[TabForge] 保存 ${key} 失败`, error);
        }
        return;
    }
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.warn(`[TabForge] 保存 ${key} 失败`, error);
    }
}
