/**
 * improvisation — AI 即兴生成模块入口
 */

export { generateImprovisation, getApiKey, saveApiKey } from './aiService.ts';
export {
    buildUserPrompt,
    composeSystemPrompt,
    DEFAULT_EXPERT_PROMPT,
    SYSTEM_PROMPT,
} from './promptBuilder.ts';
export { NOTE_CONTRACT } from './noteContract.ts';
export { parseAIResponse } from './responseParser.ts';
export { openPromptDebug } from './promptDebug.ts';
export {
    isSystemPromptTrigger,
    openSystemPromptEditor,
    getEditableSystemPrompt,
    getEffectiveSystemPrompt,
    getCustomSystemPrompt,
    saveCustomSystemPrompt,
    TRIGGER_EXTRA_PROMPT,
} from './systemPromptEditor.ts';
export type { GenerationOptions } from './promptBuilder.ts';
export type { AIGenerationResult } from './aiService.ts';