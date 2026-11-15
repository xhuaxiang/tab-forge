/**
 * jsonExtract — 从 AI 文本响应里取出 JSON 对象。
 *
 * 模型可能把 JSON 包在 markdown 代码块或前后说明里。旧 `parseAIResponse`
 * 里的提取逻辑搬到这里，供 brief / patch 解析器共用。
 */

/**
 * @returns 解析后的值；找不到 JSON 对象或解析失败时返回 null。
 */
export function extractJsonObject(rawText: string): unknown | null {
    let jsonText = rawText.trim();

    const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) jsonText = fenced[1].trim();

    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start === -1 || end <= start) return null;

    try {
        return JSON.parse(jsonText.slice(start, end + 1));
    } catch {
        return null;
    }
}
