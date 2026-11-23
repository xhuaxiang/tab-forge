/**
 * app/analytics — 业务事件到埋点的桥接。
 *
 * 只维护「播放是否已经开始」这一份内存状态，避免暂停/继续/切换引擎
 * 被重复算成新的 playback_start。
 */

import { trackAnalyticsEvent } from '../features/analytics/transport.ts';

let opened = false;
let playbackActive = false;

/** 页面真正跑起来（JS 已执行）后调用一次 */
export function initAnalytics(): void {
    if (opened) return;
    opened = true;
    trackAnalyticsEvent('app_open');
}

/** 本地 / AI 生成成功写谱后调用 */
export function trackImprovGenerated(): void {
    trackAnalyticsEvent('improv_generate');
}

/** 开始播放或切换播放引擎时调用；暂停后继续不重复上报 */
export function markPlaybackStarted(): void {
    if (playbackActive) return;
    playbackActive = true;
    trackAnalyticsEvent('playback_start');
}

/** 用户停止或自然播完后调用 */
export function markPlaybackStopped(): void {
    if (!playbackActive) return;
    playbackActive = false;
    trackAnalyticsEvent('playback_stop');
}
