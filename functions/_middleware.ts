/**
 * Cloudflare Pages Functions 中间件：把页面访问写入 `analytics_events`。
 *
 * 只记录 HTML 文档导航（GET + Accept: text/html），静态资源与 `/api/*` 不写；
 * 写库放在 waitUntil 里，不延迟响应；失败只打日志。
 */

import {
    buildPageViewParams,
    collectRequestMeta,
    insertAnalyticsEvent,
    isPageViewRequest,
    SCHEMA_VERSION,
    type PagesFunctionContext,
} from './_lib/analytics';

async function recordPageView(
    ctx: PagesFunctionContext,
    status: number,
): Promise<void> {
    try {
        const request = ctx.request;
        const url = new URL(request.url);
        const now = Date.now();
        const meta = await collectRequestMeta(request, ctx.env.IP_SALT);

        await insertAnalyticsEvent(ctx.env, {
            schemaVersion: SCHEMA_VERSION,
            type: 'page_view',
            ts: now,
            receivedAt: now,
            installId: null,
            sessionId: null,
            platform: 'web',
            appVersion: null,
            locale: null,
            params: buildPageViewParams(
                url,
                request.headers.get('Referer') ?? '',
                status,
            ),
            ...meta,
        });
    } catch (error) {
        console.error('[TabForge] page_view 写入失败', error);
    }
}

export const onRequest = async (
    ctx: PagesFunctionContext,
): Promise<Response> => {
    const response = await ctx.next();
    if (!isPageViewRequest(ctx.request)) return response;

    const task = recordPageView(ctx, response.status);
    if (typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(task);
    } else {
        await task;
    }
    return response;
};
