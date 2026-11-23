/**
 * Pages Functions 埋点公共逻辑。
 *
 * 目录以 `_` 开头，不会被当成路由；`_middleware.ts` 与 `api/hit.ts` 共用。
 * 该目录由 Cloudflare 构建时单独编译，不在项目 tsconfig 内，
 * 因此这里自带最小 D1 / Pages 类型声明。
 */

interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    run(): Promise<unknown>;
}

interface D1Database {
    prepare(query: string): D1PreparedStatement;
}

export interface AnalyticsEnv {
    DB: D1Database;
    IP_SALT?: string;
}

export interface PagesFunctionContext {
    request: Request;
    env: AnalyticsEnv;
    next(): Promise<Response>;
    waitUntil?(promise: Promise<unknown>): void;
}

export interface CfProperties {
    country?: string;
    region?: string;
    city?: string;
    asn?: number;
    colo?: string;
}

export interface RequestWithCf extends Request {
    cf?: CfProperties;
}

export const SCHEMA_VERSION = 1;
export const MAX_BODY_BYTES = 2048;

export const CLIENT_EVENT_TYPES = [
    'app_open',
    'improv_generate',
    'playback_start',
    'playback_stop',
] as const;

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export interface RequestMeta {
    ipHash: string;
    visitorHash: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    asn: number | null;
    colo: string | null;
    ua: string | null;
    device: string | null;
    browser: string | null;
    os: string | null;
    acceptLanguage: string | null;
    isBot: number;
}

export interface AnalyticsRow extends RequestMeta {
    schemaVersion: number;
    type: string;
    ts: number;
    receivedAt: number;
    installId: string | null;
    sessionId: string | null;
    platform: string | null;
    appVersion: string | null;
    locale: string | null;
    params: string;
}

export interface ClientEventInput {
    type: ClientEventType;
    ts: number;
    installId: string;
    sessionId: string | null;
    platform: 'web' | 'extension';
    appVersion: string | null;
    locale: string | null;
}

const INSERT_SQL = `
INSERT INTO analytics_events (
    schema_version, type, ts, received_at,
    install_id, session_id, platform, app_version, locale,
    params,
    ip_hash, visitor_hash, country, region, city, asn, colo,
    ua, device, browser, os, accept_language, is_bot
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export function truncate(value: string, max: number): string {
    return value.length > max ? value.slice(0, max) : value;
}

function clean(value: string | null | undefined): string | null {
    const trimmed = (value ?? '').trim();
    return trimmed === '' ? null : trimmed;
}

function detectDevice(ua: string): string | null {
    if (ua === '') return null;
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile';
    return 'desktop';
}

function detectBrowser(ua: string): string | null {
    if (ua === '') return null;
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\/|Opera/.test(ua)) return 'opera';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
}

function detectOs(ua: string): string | null {
    if (ua === '') return null;
    if (/Windows/.test(ua)) return 'windows';
    if (/Android/.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    if (/Mac OS X|Macintosh/.test(ua)) return 'macos';
    if (/Linux/.test(ua)) return 'linux';
    return 'other';
}

function detectBot(ua: string): boolean {
    return /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pingdom|uptime/i.test(ua);
}

export async function sha256(input: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(input),
    );
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

/** 取 IP / UA / 地区 / 设备等公共字段；原始 IP 只参与哈希，不落库 */
export async function collectRequestMeta(
    request: Request,
    salt: string | undefined,
): Promise<RequestMeta> {
    const cf = (request as RequestWithCf).cf ?? {};
    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    const ua = request.headers.get('User-Agent') ?? '';
    const normalizedSalt = salt ?? '';

    return {
        ipHash: await sha256(`${ip}:${normalizedSalt}`),
        visitorHash: await sha256(`${ip}|${ua}:${normalizedSalt}`),
        country: clean(cf.country ?? request.headers.get('CF-IPCountry')),
        region: clean(cf.region),
        city: clean(cf.city),
        asn: typeof cf.asn === 'number' ? cf.asn : null,
        colo: clean(cf.colo),
        ua: clean(truncate(ua, 500)),
        device: detectDevice(ua),
        browser: detectBrowser(ua),
        os: detectOs(ua),
        acceptLanguage: clean(truncate(request.headers.get('Accept-Language') ?? '', 100)),
        isBot: detectBot(ua) ? 1 : 0,
    };
}

function refererHost(referer: string): string | null {
    if (referer === '') return null;
    try {
        return clean(new URL(referer).host);
    } catch {
        return null;
    }
}

/** 页面访问的扩展属性；点击事件的 params 固定为 `{}` */
export function buildPageViewParams(url: URL, referer: string, status: number): string {
    return JSON.stringify({
        path: truncate(url.pathname, 200),
        query: clean(truncate(url.search.replace(/^\?/, ''), 500)),
        utm_source: clean(url.searchParams.get('utm_source') ?? ''),
        utm_medium: clean(url.searchParams.get('utm_medium') ?? ''),
        utm_campaign: clean(url.searchParams.get('utm_campaign') ?? ''),
        referer: clean(truncate(referer, 500)),
        referer_host: refererHost(referer),
        status,
    });
}

export async function insertAnalyticsEvent(
    env: AnalyticsEnv,
    row: AnalyticsRow,
): Promise<void> {
    if (!env.DB) throw new Error('D1 binding DB is missing');

    await env.DB.prepare(INSERT_SQL)
        .bind(
            row.schemaVersion,
            row.type,
            row.ts,
            row.receivedAt,
            row.installId,
            row.sessionId,
            row.platform,
            row.appVersion,
            row.locale,
            row.params,
            row.ipHash,
            row.visitorHash,
            row.country,
            row.region,
            row.city,
            row.asn,
            row.colo,
            row.ua,
            row.device,
            row.browser,
            row.os,
            row.acceptLanguage,
            row.isBot,
        )
        .run();
}

/** 只有 GET + Accept: text/html 才算页面访问；API 与静态资源跳过 */
export function isPageViewRequest(request: Request): boolean {
    if (request.method !== 'GET') return false;
    if (!(request.headers.get('Accept') ?? '').includes('text/html')) return false;
    const path = new URL(request.url).pathname;
    return path !== '/api' && !path.startsWith('/api/');
}

export function isClientEventType(value: unknown): value is ClientEventType {
    return typeof value === 'string'
        && (CLIENT_EVENT_TYPES as readonly string[]).includes(value);
}

function optionalString(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    return clean(truncate(value, max));
}

function isTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** 校验客户端事件；`params` 不读取，统一按 `{}` 入库 */
export function parseClientEvent(value: unknown): ClientEventInput | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;

    if (record.schema_version !== SCHEMA_VERSION) return null;
    if (!isClientEventType(record.type)) return null;
    if (!isTimestamp(record.ts)) return null;
    if (typeof record.install_id !== 'string') return null;

    const installId = record.install_id.trim();
    if (installId === '' || installId.length > 100) return null;
    if (record.platform !== 'web' && record.platform !== 'extension') return null;

    return {
        type: record.type,
        ts: record.ts,
        installId,
        sessionId: optionalString(record.session_id, 100),
        platform: record.platform,
        appVersion: optionalString(record.app_version, 50),
        locale: optionalString(record.locale, 20),
    };
}
