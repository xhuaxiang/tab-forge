import { describe, expect, it } from 'vitest';
import { ANALYTICS_EVENT_TYPES } from '../../../core/types/analytics.ts';
import {
    buildAnalyticsPayload,
    truncateAnalyticsValue,
} from '../../../core/utils/analytics.ts';

describe('buildAnalyticsPayload', () => {
    it('按固定结构组装，点击事件的 params 为空对象', () => {
        expect(buildAnalyticsPayload({
            type: 'improv_generate',
            ts: 1763900000000,
            installId: 'install-1',
            sessionId: 'session-1',
            platform: 'web',
            appVersion: '1.0.0',
            locale: 'zh-CN',
        })).toEqual({
            schema_version: 1,
            type: 'improv_generate',
            ts: 1763900000000,
            install_id: 'install-1',
            session_id: 'session-1',
            platform: 'web',
            app_version: '1.0.0',
            locale: 'zh-CN',
            params: {},
        });
    });

    it('不修改传入的上下文', () => {
        const input = {
            type: 'app_open' as const,
            ts: 1,
            installId: 'a',
            sessionId: 'b',
            platform: 'web' as const,
            appVersion: '1.0.0',
            locale: 'en',
        };
        buildAnalyticsPayload(input);
        expect(input).toEqual({
            type: 'app_open',
            ts: 1,
            installId: 'a',
            sessionId: 'b',
            platform: 'web',
            appVersion: '1.0.0',
            locale: 'en',
        });
    });
});

describe('truncateAnalyticsValue', () => {
    it('未超长时原样返回', () => {
        expect(truncateAnalyticsValue('abc', 5)).toBe('abc');
    });

    it('超长时截断到上限', () => {
        expect(truncateAnalyticsValue('abcdefgh', 5)).toBe('abcde');
    });
});

describe('ANALYTICS_EVENT_TYPES', () => {
    it('只包含客户端可上报的 4 种事件', () => {
        expect([...ANALYTICS_EVENT_TYPES]).toEqual([
            'app_open',
            'improv_generate',
            'playback_start',
            'playback_stop',
        ]);
    });
});
