/**
 * promptBuilder — 构建 DeepSeek AI 即兴生成的 system / user prompt
 *
 * 系统提示词由两半拼成，分开维护：
 *   ① 数据结构（机器契约）—— noteContract.ts，必须与 responseParser.ts 对齐
 *   ② 专业性描述（人的写作）—— 本文件：人格 / 节奏 / 旋律 / 演奏约束
 * 调 ② 只影响生成质量；动 ① 会让解析失败。边界就在这里。
 *
 * ① 不参与编辑，也不在编辑器/调试面板里展示：用户只经手 ②，
 * 发请求前由 composeSystemPrompt 把 ① 恒定追加回去，避免契约被改坏导致解析静默失败。
 *
 * 注（调试期实验）：user prompt 已最小化，仅含 extraPrompt + 输出格式要求；
 * 调性/BPM/拍号/调弦 等 score 上下文注入暂时移除，原实现保留在 git 历史中。
 */

import { NOTE_CONTRACT } from './noteContract.ts';

// ---- 专业性描述（调音色改这里）----

/** 人格：模型在即兴演奏中的身份设定 */
const PERSONA = `你是一位精通吉他即兴演奏的 AI 音乐助手。
你需要为六线谱（Tablature）生成即兴独奏音符，输出必须为合法 JSON。`;

/** 演奏要求：节奏 / 旋律 / 吉他约束 */
const EXPERT_RULES = `## 节奏多样性（最重要，严格遵守）
- 同一小节内必须混合不同时值，严禁所有音符等长。典型模式如：
  - "短-短-短-长"：3×八分(0.125) + 1×二分(0.5)
  - "长-短-短"：1×四分(0.25) + 2×八分(0.125)
  - "附点感"：1×四分(0.25) + 1×八分(0.125) + 1×四分(0.25)
- 每小节都应有一个明确的节奏型，且相邻小节节奏型要不同，避免全曲重复同一种。
- 每小节所有音符 duration 总和必须精确等于拍号总拍数（4/4 拍 = 4.0，3/4 拍 = 3.0）。
- 用休止符(isRest: true)在乐句之间制造呼吸与停顿，每 4-8 拍至少一处。
- 用 tieToNext: true 让长音跨拍延续，增强歌唱感。

## 旋律与乐句
- 围绕调性音阶组织音高，避免长时间在单根弦上机械爬格。
- 善用"动机"：先给出短小旋律动机，再变奏、模进、发展，形成起承转合。
- 乐句结尾落在主音或调内稳定音，制造"答句"收束感。
- 同一小节内音区要有起伏（上行、下行、跳进），不要平铺直叙。
- 在品位跳进处自然加入 hammerOn / pullOff / slide 技法，让演奏有粘性。

## 吉他演奏约束
- 只用吉他指板合理范围内的音（标准调弦 0-24 品）
- 指板音区：以 7-12 品**步进移动**为主，偶尔可跳进到 1-6 品
- 空弦音（0 品）：不受 7-12 品音区限制，可自由加入增加色彩
- 小节数：不少于 3 小节，每个小节不要有太多空音
- 结尾音尽量回到主音并给足时值
- ⚠️ 若用户提供了额外提示，以上默认约束一律以额外提示为准`;

// ---- System Prompt ----

/** 默认专业性描述（不含数据结构）—— 编辑器/调试面板预填与「恢复默认」用 */
const DEFAULT_EXPERT_PROMPT = [PERSONA, EXPERT_RULES].join('\n\n');

/**
 * 把专业性描述补全成完整 system prompt：数据结构由代码恒定追加。
 * @param expertPrompt 可编辑的专业性描述，空则用默认
 */
export function composeSystemPrompt(expertPrompt?: string): string {
    const body = expertPrompt?.trim() ? expertPrompt : DEFAULT_EXPERT_PROMPT;
    return `${body}\n\n${NOTE_CONTRACT}`;
}

/** 数据结构块的起止标记：读取旧版整段自定义提示词时用来把这块剥掉 */
const CONTRACT_START = '## 音符对象格式';
const EDITABLE_START = '## 节奏多样性';

/**
 * 从旧版自定义提示词里剥掉内嵌的数据结构块。
 * 早期保存的是「专业性描述 + 契约」整段，直接沿用会与 composeSystemPrompt 追加的契约重复。
 */
export function stripContract(text: string): string {
    const start = text.indexOf(CONTRACT_START);
    if (start < 0) return text;
    const resume = text.indexOf(EDITABLE_START, start);
    const head = text.slice(0, start).replace(/\n+$/, '');
    const tail = resume < 0 ? '' : text.slice(resume).replace(/^\n+/, '');
    return [head, tail].filter(Boolean).join('\n\n');
}

/** 默认完整 system prompt（默认专业性描述 + 数据结构） */
const SYSTEM_PROMPT = composeSystemPrompt();

// ---- Build User Prompt ----
export function buildUserPrompt(options: GenerationOptions): string {
    const parts: string[] = [];

    if (options.extraPrompt) {
        parts.push(`\n⚠️ 额外要求（优先级最高，如与默认约束冲突以它为准）: ${options.extraPrompt}`);
    }

    parts.push('\n请直接输出 JSON，不要包裹在 markdown 代码块中。');

    return parts.join('\n');
}

export interface GenerationOptions {
    numMeasures: number;
    scaleType: string;
    style: string;
    density: string;
    extraPrompt?: string;
}

export { SYSTEM_PROMPT, DEFAULT_EXPERT_PROMPT };
