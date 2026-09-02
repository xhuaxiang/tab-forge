/**
 * TabForge Background Service Worker
 * 后台服务工作进程 - 处理持久化存储和跨页面通信
 */

import type { TabScore } from './core/types/index.ts';

// 默认乐谱数据
const DEFAULT_SCORE: TabScore = {
    title: '新乐谱',
    artist: '',
    tuning: {
        string1: 'E4',
        string2: 'B3',
        string3: 'G3',
        string4: 'D3',
        string5: 'A2',
        string6: 'E2',
    },
    bpm: 120,
    measures: [],
    key: 'C',
    timeSignature: '4/4',
    remarks: '',
};

// ============================================================
// 存储管理
// ============================================================

async function saveScore(score: TabScore): Promise<void> {
    try {
        await chrome.storage.local.set({ TabForgeScore: score });
        console.log('[TabForge] 乐谱已保存');
    } catch (error) {
        console.error('[TabForge] 保存失败:', error);
    }
}

async function loadScore(): Promise<TabScore | null> {
    try {
        const result = await chrome.storage.local.get<{ TabForgeScore?: TabScore }>('TabForgeScore');
        return result.TabForgeScore || null;
    } catch (error) {
        console.error('[TabForge] 加载失败:', error);
        return null;
    }
}

// ============================================================
// 消息监听
// ============================================================

chrome.runtime.onMessage.addListener((request: { action: any; score: TabScore; options?: any; }, _sender: any, sendResponse: (arg0: { success: boolean; data?: TabScore; message?: string; error?: string; result?: any; }) => void) => {
    switch (request.action) {
        case 'saveScore':
            saveScore(request.score).then(() => {
                sendResponse({ success: true });
            });
            return true; // 异步响应

        case 'loadScore':
            loadScore().then((score) => {
                sendResponse({ success: true, data: score || DEFAULT_SCORE });
            });
            return true;

        case 'exportTab':
            sendResponse({
                success: true,
                message: 'Export functionality handled in popup',
            });
            return true;

        case 'generateImprovisation':
            handleAIGeneration(request.score, request.options)
                .then((result) => sendResponse({ success: true, result }))
                .catch((err) => sendResponse({ success: false, error: err.message }));
            return true;

        default:
            console.warn('[TabForge] 未知消息:', request.action);
            sendResponse({ success: false, error: `Unknown action: ${request.action}` });
            return true;
    }
});

// ============================================================
// AI Generation Proxy（background 代理调用 DeepSeek）
// ============================================================

async function handleAIGeneration(score: TabScore, options: any): Promise<any> {
    const STORAGE_KEY = 'TabForge_DeepSeekApiKey';
    const storageResult = await chrome.storage.local.get(STORAGE_KEY);
    const apiKey = storageResult[STORAGE_KEY];

    if (!apiKey) {
        throw new Error('未设置 DeepSeek API Key，请在弹出面板的 AI 区域输入');
    }

    const SYSTEM_PROMPT = `你是一位精通吉他即兴演奏的 AI 音乐助手。需要为六线谱生成即兴独奏音符，输出必须为合法 JSON。

## 音符对象格式
{
  "string": 数字,    // 弦号 1-6（1=高音E最细, 6=低音E最粗）
  "fret": 数字,      // 品位 0-24（0=空弦）
  "duration": 数字,  // 时值: 1=全音符, 0.5=二分, 0.25=四分, 0.125=八分, 0.0625=十六分
  "isRest": 布尔,
  "technique": "hammerOn" | "pullOff" | "slide" | null,
  "targetFret": 数字,
  "tieToNext": 布尔,
  "chordGroup": 数字,
  "arpeggio": "up" | "down" | null,
  "strum": "up" | "down" | null
}

## 输出格式
{"measures": [{"notes": [...]}]}

## 吉他演奏约束
- 只用吉他指板合理范围内的音（标准调弦 0-24 品）
- 步进移动为主（1-3 品），偶尔跳进（4-7 品）
- 同一弦相邻音符间出现品位跳跃时，可添加技法
- 适当加入空弦音和休止符
- 结尾音尽量回到主音`;

    const tuning = score.tuning;
    const tuningStr = `1弦=${tuning.string1}, 2弦=${tuning.string2}, 3弦=${tuning.string3}, 4弦=${tuning.string4}, 5弦=${tuning.string5}, 6弦=${tuning.string6}`;

    const userPrompt = [
        `请生成 ${options.numMeasures} 小节吉他即兴独奏。`,
        `- 调性: ${score.key || 'C'}`,
        `- 音阶类型: ${options.scaleType}`,
        `- BPM: ${score.bpm}`,
        `- 拍号: ${score.timeSignature}`,
        `- 调弦: ${tuningStr}`,
        `- 风格偏好: ${options.style}`,
        `- 音符密度: ${options.density}`,
        options.extraPrompt ? `\n额外要求: ${options.extraPrompt}` : '',
        '\n请直接输出 JSON，不要包裹在 markdown 代码块中。',
    ].filter(Boolean).join('\n');

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            // 注意：deepseek-chat 旧别名已于 2026-07-24 下线，必须用 V4 模型 ID
            model: 'deepseek-v4-flash',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.8,
            max_tokens: 4096,
            response_format: { type: 'json_object' },
            // 关闭默认思考模式，避免长时间思考导致超时 / 空 content
            thinking: { type: 'disabled' },
        }),
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        let errMsg = `API 请求失败 (HTTP ${response.status})`;
        try {
            const errJson = JSON.parse(errBody);
            if (errJson.error?.message) errMsg = errJson.error.message;
        } catch { /* keep default */ }
        throw new Error(errMsg);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
        throw new Error('AI 未返回内容');
    }

    let jsonText = content.trim();
    const objStart = jsonText.indexOf('{');
    const objEnd = jsonText.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
        jsonText = jsonText.substring(objStart, objEnd + 1);
    }

    const parsed = JSON.parse(jsonText);
    const allNotes: any[] = [];

    if (parsed.measures && Array.isArray(parsed.measures)) {
        for (const measure of parsed.measures) {
            if (measure.notes && Array.isArray(measure.notes)) {
                for (const note of measure.notes) {
                    if (!note) continue;
                    if (note.isRest) {
                        allNotes.push({ isRest: true, duration: note.duration || 0.25 });
                        continue;
                    }
                    const s = note.string ?? 1;
                    if (s < 1 || s > 6) continue;
                    const f = note.fret ?? 0;
                    if (f < 0 || f > 24) continue;
                    allNotes.push(note);
                }
            }
        }
    }

    if (allNotes.length === 0) {
        throw new Error('AI 返回的 measures 中没有有效音符');
    }

    return { notes: allNotes };
}

// ============================================================
// 扩展安装/更新事件
// ============================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`[TabForge] 扩展已${details.reason === 'install' ? '安装' : '更新'}`);

    // 首次安装时初始化默认数据
    if (details.reason === 'install') {
        await saveScore(DEFAULT_SCORE);
        console.log('[TabForge] 初始数据已创建');
    }
});

export {};
