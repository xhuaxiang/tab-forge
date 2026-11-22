/**
 * Cloudflare Pages Functions 中间件：把页面访问记录到 D1。
 *
 * 该目录由 Cloudflare 构建时单独编译，不在项目 tsconfig 的 include（"src"）内，
 * 因此这里自带最小类型声明，不依赖 @cloudflare/workers-types。
 *
 * 只记录 HTML 文档导航（GET + Accept: text/html），静态资源不写库；
 * 配合 public/_routes.json，静态资源也不会触发 Functions。
 */

interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    run(): Promise<unknown>;
}

interface D1Database {
    prepare(query: string): D1PreparedStatement;
}

interface Env {
    DB: D1Database;
    IP_SALT: string;
}

interface PagesFunctionContext {
    request: Request;
    env: Env;
    next(): Promise<Response>;
    waitUntil(promise: Promise<unknown>): void;
}

interface RequestWithCf extends Request {
    cf?: {
        country?: string;
        city?: string;
        asn?: number;
    };
}

async function sha256(input: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(input),
    );
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export const onRequest = async (
    ctx: PagesFunctionContext,
): Promise<Response> => {
    const response = await ctx.next();

    const isPageView =
        ctx.request.method === 'GET' &&
        (ctx.request.headers.get('Accept') ?? '').includes('text/html');

    if (!isPageView) return response;

    const request = ctx.request as RequestWithCf;
    const url = new URL(request.url);
    const cf = request.cf ?? {};

    const ip = ctx.request.headers.get('CF-Connecting-IP') ?? '';
    const ua = ctx.request.headers.get('User-Agent') ?? '';
    const referer = ctx.request.headers.get('Referer') ?? '';

    ctx.waitUntil(
        (async () => {
            const ipHash = await sha256(`${ip}:${ctx.env.IP_SALT}`);
            await ctx.env.DB.prepare(
                `INSERT INTO visits (ts, ip_hash, ua, path, referer, country, city, asn)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
                .bind(
                    Date.now(),
                    ipHash,
                    ua,
                    url.pathname,
                    referer,
                    cf.country ?? '',
                    cf.city ?? '',
                    cf.asn ?? 0,
                )
                .run();
        })().catch(() => {
            // 埋点失败不影响页面响应
        }),
    );

    return response;
};
