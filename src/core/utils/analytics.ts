/**
 * 埋点载荷组装（纯函数）。
 *
 * 只负责把调用方给的上下文收敛成固定结构；不发请求、不读存储。
 */

import type {
    AnalyticsEventType,
    AnalyticsPayload,
    AnalyticsPlatform,
} from '../types/analytics.ts';

export interface AnalyticsPayloadInput {
    type: AnalyticsEventType;
    ts: number;
    installId: string;
    sessionId: string;
    platform: AnalyticsPlatform;
    appVersion: string;
    locale: string;
}

/** 当前点击事件不采集专属参数；以后加键时只改这里与 types。 */
export function buildAnalyticsPayload(input: AnalyticsPayloadInput): AnalyticsPayload {
    return {
        schema_version: 1,
        type: input.type,
        ts: input.ts,
        install_id: input.installId,
        session_id: input.sessionId,
        platform: input.platform,
        app_version: input.appVersion,
        locale: input.locale,
        params: {},
    };
}

/** 截断字符串，避免异常长值把请求体撑大。 */
export function truncateAnalyticsValue(value: string, max: number): string {
    return value.length > max ? value.slice(0, max) : value;
}
