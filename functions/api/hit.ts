/**
 * POST /api/hit — 客户端点击事件上报。
 *
 * 只接受 4 种点击事件；params 不读取，统一存 `{}`。
 * 成功 200、校验失败 400；写库失败只打日志，不改变响应。
 */

import {
    collectRequestMeta,
    insertAnalyticsEvent,
    MAX_BODY_BYTES,
    parseClientEvent,
    SCHEMA_VERSION,
    type PagesFunctionContext,
} from '../_lib/analytics';

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
};

function respond(status: number): Response {
    return new Response(null, { status, headers: CORS_HEADERS });
}

export const onRequest = async (
    ctx: PagesFunctionContext,
): Promise<Response> => {
    if (ctx.request.method === 'OPTIONS') return respond(204);
    if (ctx.request.method !== 'POST') return respond(405);

    const contentLength = Number(ctx.request.headers.get('Content-Length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        return respond(400);
    }

    const contentType = ctx.request.headers.get('Content-Type') ?? '';
    if (contentType !== ''
        && !contentType.includes('text/plain')
        && !contentType.includes('application/json')) {
        return respond(400);
    }

    let text: string;
    try {
        text = await ctx.request.text();
    } catch {
        return respond(400);
    }
    if (text.length > MAX_BODY_BYTES) return respond(400);

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return respond(400);
    }

    const event = parseClientEvent(parsed);
    if (!event) return respond(400);

    try {
        const now = Date.now();
        const meta = await collectRequestMeta(ctx.request, ctx.env.IP_SALT);
        // UV 只按 page_view 算，客户端事件不写 visitor_hash
        const eventMeta = { ...meta, visitorHash: null as string | null };

        const write = insertAnalyticsEvent(ctx.env, {
            schemaVersion: SCHEMA_VERSION,
            type: event.type,
            ts: event.ts,
            receivedAt: now,
            installId: event.installId,
            sessionId: event.sessionId,
            platform: event.platform,
            appVersion: event.appVersion,
            locale: event.locale,
            // 客户端事件的扩展参数暂时全部丢弃
            params: '{}',
            ...eventMeta,
        }).catch(error => {
            console.error('[TabForge] 客户端事件写入失败', error);
        });

        if (typeof ctx.waitUntil === 'function') ctx.waitUntil(write);
        else await write;
    } catch (error) {
        console.error('[TabForge] 客户端事件处理失败', error);
    }

    return respond(200);
};
