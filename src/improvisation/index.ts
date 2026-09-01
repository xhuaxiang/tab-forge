/**
 * improvisation — AI 即兴生成模块入口
 */

export { generateImprovisation, getApiKey, saveApiKey } from './aiService.ts';
export { buildUserPrompt, SYSTEM_PROMPT } from './promptBuilder.ts';
export { parseAIResponse } from './responseParser.ts';
export {
    isSystemPromptTrigger,
    openSystemPromptEditor,
    getEffectiveSystemPrompt,
    getCustomSystemPrompt,
    saveCustomSystemPrompt,
    TRIGGER_EXTRA_PROMPT,
} from './systemPromptEditor.ts';
export type { GenerationOptions } from './promptBuilder.ts';
export type { AIGenerationResult } from './aiService.ts';