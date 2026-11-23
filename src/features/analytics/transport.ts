/**
 * analytics/transport — 客户端埋点发送。
 *
 * 当前只接网页：扩展构建里直接不发（endpoint 是相对路径，扩展内会解析到
 * `chrome-extension://`，等接扩展时再改绝对地址与 host_permissions）。
 *
 * 发送失败只告警、不重试、不排队；埋点不能影响主流程。
 */

import {
    ANALYTICS_ENABLED,
    ANALYTICS_ENDPOINT,
    APP_VERSION,
} from '../../core/config.ts';
import { getLocale } from '../../core/i18n/index.ts';
import type {
    AnalyticsEventType,
    AnalyticsPlatform,
} from '../../core/types/analytics.ts';
import { buildAnalyticsPayload } from '../../core/utils/analytics.ts';
import { readStorage, writeStorage } from '../storage.ts';

const INSTALL_ID_KEY = 'TabForge_InstallId';
const SESSION_KEY = 'TabForge_AnalyticsSession';
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_ID_LENGTH = 100;

interface StoredSession {
    id: string;
    lastActive: number;
}

function createId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `tf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function detectPlatform(): AnalyticsPlatform {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id ? 'extension' : 'web';
}

const PLATFORM = detectPlatform();
const ACTIVE = ANALYTICS_ENABLED && PLATFORM === 'web';

let installIdPromise: Promise<string> | null = null;
let sessionPromise: Promise<StoredSession> | null = null;

async function loadInstallId(): Promise<string> {
    const stored = (await readStorage(INSTALL_ID_KEY))?.trim();
    if (stored && stored.length <= MAX_ID_LENGTH) return stored;

    const id = createId();
    await writeStorage(INSTALL_ID_KEY, id);
    return id;
}

function getInstallId(): Promise<string> {
    installIdPromise ??= loadInstallId();
    return installIdPromise;
}

function isStoredSession(value: unknown): value is StoredSession {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.id === 'string'
        && record.id !== ''
        && record.id.length <= MAX_ID_LENGTH
        && typeof record.lastActive === 'number'
        && Number.isFinite(record.lastActive);
}

async function loadSession(): Promise<StoredSession> {
    const raw = await readStorage(SESSION_KEY);
    if (raw) {
        try {
            const parsed: unknown = JSON.parse(raw);
            if (isStoredSession(parsed)) return parsed;
        } catch {
            // 存储损坏按新会话处理
        }
    }
    return { id: createId(), lastActive: Date.now() };
}

async function getSession(): Promise<StoredSession> {
    sessionPromise ??= loadSession();
    const loaded = await sessionPromise;
    const now = Date.now();
    const session = now - loaded.lastActive > SESSION_TTL_MS
        ? { id: createId(), lastActive: now }
        : { id: loaded.id, lastActive: now };

    // 更新最后活跃时间，下次打开页面仍能沿用同一个 session
    void writeStorage(SESSION_KEY, JSON.stringify(session));
    return session;
}

async function send(type: AnalyticsEventType): Promise<void> {
    const [installId, session] = await Promise.all([getInstallId(), getSession()]);
    const body = JSON.stringify(buildAnalyticsPayload({
        type,
        ts: Date.now(),
        installId,
        sessionId: session.id,
        platform: PLATFORM,
        appVersion: APP_VERSION,
        locale: getLocale(),
    }));

    // playback_stop 可能是离开页面前的最后一个动作，优先用 beacon
    if (type === 'playback_stop'
        && typeof navigator !== 'undefined'
        && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(ANALYTICS_ENDPOINT, blob)) return;
    }

    await fetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
        keepalive: true,
        credentials: 'omit',
    });
}

/** 只记「发生了」；失败只告警，不阻塞调用方 */
export function trackAnalyticsEvent(type: AnalyticsEventType): void {
    if (!ACTIVE) return;
    void send(type).catch(error => {
        console.warn('[TabForge] 埋点发送失败', error);
    });
}
