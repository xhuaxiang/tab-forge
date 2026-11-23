/**
 * 埋点事件类型与客户端上报载荷。
 *
 * 当前只采集「发生了」，点击事件的 params 固定为空对象；
 * 页面访问的扩展参数由服务端中间件生成，不走这里。
 */

export const ANALYTICS_EVENT_TYPES = [
    'app_open',
    'improv_generate',
    'playback_start',
    'playback_stop',
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export type AnalyticsPlatform = 'web' | 'extension';

export interface AnalyticsPayload {
    schema_version: 1;
    type: AnalyticsEventType;
    ts: number;
    install_id: string;
    session_id: string;
    platform: AnalyticsPlatform;
    app_version: string;
    locale: string;
    params: Record<string, never>;
}
