/**
 * promptTriggers — 隐藏提示词编辑功能的触发词（纯函数，无 DOM）。
 *
 * 旧「从零生成」编辑器与新「本地底稿 + AI 扩展」编辑器共用同一触发词；
 * 这里单独收口，避免新编辑器为了复用而依赖带 UI 的旧模块。
 */

/** 触发隐藏功能的额外要求文案 */
export const TRIGGER_EXTRA_PROMPT = '修改系统对话';

/** 是否命中隐藏功能触发词（extraPrompt 精确等于「修改系统对话」） */
export function isSystemPromptTrigger(extraPrompt?: string): boolean {
    return extraPrompt?.trim() === TRIGGER_EXTRA_PROMPT;
}
