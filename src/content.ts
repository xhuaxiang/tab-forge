/**
 * TabForge Content Script
 * 内容脚本 - 用于与网页交互
 * 
 * 未来功能:
 * - 从网页中提取和弦/六线谱信息
 * - 在网页上标注音符
 * - 与音频播放器交互
 */

console.log('[TabForge] Content script loaded');

// ============================================================
// 与网页中的乐谱交互
// ============================================================

interface ScrapedTabData {
    source: string;
    title: string;
    artist: string;
    tabText: string;
    tuning?: string;
}

/**
 * 从当前页面尝试提取乐谱文本
 * 用于未来智能扒谱功能
 */
function scrapePageForTab(): ScrapedTabData | null {
    const pageText = document.body.innerText;

    // 检测是否包含六线谱特征
    const tabPatterns = [
        /[eBGDAE]\|[-0-9|]+\|/i,  // ASCII tab 特征
        /(?:TAB|tablature|六线谱|吉他谱)/i,
    ];

    const isTabPage = tabPatterns.some(p => p.test(pageText));
    if (!isTabPage) return null;

    // 尝试提取标题
    const title = document.title || 'Unknown';
    
    return {
        source: window.location.href,
        title,
        artist: '',
        tabText: pageText.substring(0, 5000), // 限制长度
    };
}

// ============================================================
// 消息监听
// ============================================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    switch (request.action) {
        case 'scrapeTab':
            const data = scrapePageForTab();
            sendResponse({ success: true, data });
            break;

        case 'ping':
            sendResponse({ success: true, message: 'TabForge content script active' });
            break;

        default:
            sendResponse({ success: false, error: `Unknown action: ${request.action}` });
    }
});

export {};
