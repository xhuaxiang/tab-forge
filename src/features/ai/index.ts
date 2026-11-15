/**
 * improvisation — AI 即兴生成模块入口
 *
 * 新流程（本地底稿 + AI 扩展）的 brief / patch 两段与旧「从零生成」
 * 并存导出：旧函数保留但不再被 AI 面板调用，后续可单独清理。
 */

export {
    callDeepSeek,
    debugGenerate,
    generateImprovisation,
    generateViaBackground,
    getApiKey,
    saveApiKey,
} from './aiService.ts';
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

// ---- 新：本地底稿 + AI 表现扩展 ----
export {
    BRIEF_CONTRACT,
    BRIEF_CONTRACT_HEADING,
    composeBriefSystemPrompt,
    DEFAULT_BRIEF_PROMPT,
    stripBriefContract,
} from './improvBriefPrompt.ts';
export {
    PATCH_CONTRACT,
    PATCH_CONTRACT_HEADING,
    composePatchSystemPrompt,
    DEFAULT_PATCH_PROMPT,
    stripPatchContract,
} from './improvPatchPrompt.ts';
export { parseImprovBriefResponse } from './improvBriefParser.ts';
export type { ImprovBriefParseResult } from './improvBriefParser.ts';
export { parseImprovPatchesResponse } from './improvPatchParser.ts';
export type { ImprovPatchParseResult } from './improvPatchParser.ts';
export {
    buildBriefUserPrompt,
    buildPatchUserPrompt,
    requestImprovBrief,
    requestImprovPatches,
} from './improvService.ts';
export type {
    ImprovBriefRequest,
    ImprovBriefResult,
    ImprovPatchRequest,
    ImprovPatchResult,
} from './improvService.ts';
export { runImprovPipeline } from './improvPipeline.ts';
export type {
    ImprovPipelineDeps,
    ImprovPipelineInput,
    ImprovPipelineResult,
} from './improvPipeline.ts';
export {
    getCustomBriefPrompt,
    getCustomPatchPrompt,
    getEditableBriefPrompt,
    getEditablePatchPrompt,
    getEffectiveBriefPrompt,
    getEffectivePatchPrompt,
    openImprovPromptEditor,
    saveCustomBriefPrompt,
    saveCustomPatchPrompt,
} from './improvPromptEditor.ts';
export { openImprovPromptDebug } from './improvPromptDebug.ts';
export type { ImprovPromptDebugOptions } from './improvPromptDebug.ts';
export type { GenerationOptions } from './promptBuilder.ts';
export type { AIGenerationResult } from './aiService.ts';
