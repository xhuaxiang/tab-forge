/**
 * i18n — 纯文案层（无 DOM / 存储 / 浏览器 API）。
 *
 * 字典以 zh-CN 为唯一事实源：`MessageKey` 由它派生，en 缺失 key 会在编译期报错。
 * 默认语言固定 zh-CN，保证 node 测试与既有中文断言不依赖启动流程；
 * 语言检测与持久化由 app 层完成后再调用 `setLocale`。
 */

import { EN, ZH_CN } from './messages.ts';

export type Locale = 'zh-CN' | 'en';
export type MessageParams = Record<string, string | number>;
/** 英文单复数用；中文两条取同值 */
export interface PluralMessage {
    one: string;
    other: string;
}
export type MessageValue = string | PluralMessage;
export type MessageKey = keyof typeof ZH_CN;

const LOCALES: readonly Locale[] = ['zh-CN', 'en'];

let currentLocale: Locale = 'zh-CN';

export function isLocale(value: unknown): value is Locale {
    return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function getLocale(): Locale {
    return currentLocale;
}

export function setLocale(locale: Locale): void {
    currentLocale = locale;
}

export function hasMessage(key: string): key is MessageKey {
    return Object.prototype.hasOwnProperty.call(ZH_CN, key);
}

function pickValue(value: MessageValue | undefined, params?: MessageParams): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string') return value;
    return params?.count === 1 ? value.one : value.other;
}

/** 只替换 `{name}`；缺参原样保留，便于测试发现漏传 */
function interpolate(template: string, params?: MessageParams): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (raw, name: string) => {
        const value = params[name];
        return value === undefined ? raw : String(value);
    });
}

/**
 * 取文案。回退链：当前语言 → zh-CN → 原样返回 key。
 * 英文空字符串视同缺失。
 */
export function t(key: MessageKey, params?: MessageParams): string {
    const dict: Record<string, MessageValue> = currentLocale === 'en' ? EN : ZH_CN;
    let value = pickValue(dict[key], params);
    if (value === undefined || value === '') {
        value = pickValue(ZH_CN[key], params);
    }
    if (value === undefined || value === '') return key;
    return interpolate(value, params);
}

/** 浏览器语言标签 → 界面语言；空值回落中文，保持既有默认 */
export function detectLocaleFromLanguage(tag: string | null | undefined): Locale {
    const value = (tag ?? '').trim().toLowerCase();
    if (value === '') return 'zh-CN';
    return value === 'zh' || value.startsWith('zh-') ? 'zh-CN' : 'en';
}
