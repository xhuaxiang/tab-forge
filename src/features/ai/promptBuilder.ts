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
 * user prompt 由 buildUserPrompt 拼：任务参数 + 风格/密度文案 + 额外要求。
 * 风格/密度文案的唯一来源是 core/config.ts 的 IMPROV_CONFIG.hint（调试面板同源）。
 *
 * 注：调性/BPM/拍号/调弦 等 score 上下文注入仍处于移除状态（调试期实验的遗留），
 * 原实现保留在 git 历史中；恢复与否待定——目前拍号靠容量说明里的通用规则兜。
 */

import { NOTE_CONTRACT } from './noteContract.ts';
import { IMPROV_CONFIG, getHint } from '../../core/config.ts';

// ---- 专业性描述（调音色改这里）----

/** 人格：模型在即兴演奏中的身份设定 */
const PERSONA = `你是一位精通吉他即兴演奏的 AI 音乐助手。
你需要为六线谱（Tablature）生成即兴独奏音符，输出必须为合法 JSON。`;

/** 演奏要求：节奏 / 和声织体 / 乐句 / 技法（风格中立的底盘；风格特性见 IMPROV_CONFIG.styles[].hint） */
const EXPERT_RULES = `## 节奏多样性
- 时值只能取 0.03125 / 0.0625 / 0.125 / 0.25 / 0.5 / 1 六个值；填其它数会被系统就近改写，节奏直接错位。
- 本系统不支持三连音；要摇摆感，就用"长-短"成对（0.25 接 0.125，约 2:1）与切分来暗示。
- 每小节的 duration 总和要等于该小节容量（拍号分子 ÷ 分母：4/4 = 1.0，3/4 = 0.75，6/8 = 0.75）；不足时系统会按容量把音符重排，乐句边界会错位。
- 要长音就把 duration 写长，不要用 tieToNext 拼接；相邻小节别用同一个节奏型，复制粘贴会听成练习曲。

## 像吉他手一样起句、发展、收束
- 先抛一个 2-4 个音的短动机；之后靠换句尾、整体移高或移低模进、换到相邻弦重述来发展它，而不是一路换新素材。
- 心里要有"一问一答"：后一句常借前一句的句头、换掉句尾；几句之间毫无关联地换素材会听成散装。
- 用休止符(isRest: true)换气，句子之间留停顿；一句之内音区要有起伏，不要平铺或机械爬格。
- 强拍上的音优先取稳定音（主音 / 三音 / 五音，或该风格所需的和弦色彩音），经过音、邻音放弱拍或短时值；句尾落在稳定音上收住。
- 把位默认偏中高，但不要固定在某一段品数上——该动就动，也可以跳回低把位换音色；具体取向以风格要求为准。

## 和声织体（默认要有）
- **每 2-3 小节至少安排 1 处和声**，用 chordGroup 表达。整段全是单音会显得单调——这是默认要求，不是可选装饰。
- 和声的三个落点：强拍重音（双音）、乐句收束（3-4 音的和弦落音）、换织体处（分解和弦）。和弦是点缀，别连续超过一小节都在堆和弦。
- 双音 / 和弦：同一拍同时响的音共享一个 chordGroup 编号，不同的和弦换不同编号（编号重复且相邻会被系统并成同一拍）；组内每个音各写自己的 string 与 fret，在数组里紧挨着排列、时值相同，且不要有同一根弦的两个音；单音不写 chordGroup。
- 分解和弦 / 琶音：同一个 chordGroup 里放 3-4 个音，并在该组第一个音上加 "arpeggio": "up" 或 "down"，系统会按该方向依次拨出；整拍齐扫时改用 "strum": "up" 或 "down"。arpeggio / strum 只有挂在带 chordGroup 的音上才生效。

## 演奏法
- 五种技法都可用：hammerOn / pullOff（同一根弦上相差 1-2 品的相邻音，给 targetFret）、slide（同弦换把，给 targetFret）、bend（推弦：给 bendAmount —— 0.25=1/4 音、0.5=1/2 音、1=全音；推上去再放回来加 "bendRelease": true）、vibrato（揉弦）。
- 技法用来连接乐句、点缀重音，不要每个音都挂；音必须落在 0-24 品内，越界会被整条丢弃。
- **推弦与揉弦是味道的关键**：蓝调里用 bend 把 b3→3、b5→5 抹上去，用 vibrato 让长音"唱"起来；缺了这两样，句子会显得平。

## 力度（律动感的来源）
- 给音符标力度：强拍（第 1、3 拍）与乐句的第一个音用 "dynamics": "accent"，弱拍上的经过音、装饰音用 "dynamics": "soft"；其余不写。
- 全部等响会听成机械练习；重音与轻音的对比就是律动。

## 以上都是默认取向，不是硬性规则
- 风格要求与额外要求都可以改写上面任何一条，冲突时以它们为准。
- 例如额外要求写"只弹单音"，就完全不要用 chordGroup / arpeggio / strum，整段只出单音线条。`;

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

/**
 * 拼本次生成的任务描述。
 *
 * 顺序固定：任务参数 → 风格 → 密度 → 额外要求 → 输出格式。
 * 之所以风格/密度必须走这里而不是只写进系统提示词：**系统提示词可被用户整段覆盖**
 * （systemPromptEditor 存的自定义提示词会顶掉 DEFAULT_EXPERT_PROMPT），
 * 而风格/密度是每次生成的选择，必须由代码保证送达。
 *
 * 来源统一是 core/config.ts 的 IMPROV_CONFIG（`hint` 只服务提示词，UI 不读它），
 * 所以「实际生成」与「调试面板」用的是同一套文案。
 */
export function buildUserPrompt(options: GenerationOptions): string {
    const styleOpt = IMPROV_CONFIG.styles.find(s => s.value === options.style);
    const densityOpt = IMPROV_CONFIG.densities.find(d => d.value === options.density);
    const styleHint = getHint(IMPROV_CONFIG.styles, options.style);
    const densityHint = getHint(IMPROV_CONFIG.densities, options.density);

    const parts: string[] = [];

    // 1) 任务参数 + 容量约束（系统提示词可能被覆盖，容量这条必须在这里也出现一次）
    parts.push([
        '## 本次任务',
        `- 小节数：${options.numMeasures}`,
        `- 音阶类型：${options.scaleType}`,
        `- 风格：${styleOpt?.label ?? options.style}（${options.style}）`,
        `- 密度：${densityOpt?.label ?? options.density}`,
        '',
        '每小节的 duration 总和要等于该小节容量（拍号分子 ÷ 分母：4/4 = 1.0，3/4 = 0.75，6/8 = 0.75）；不足时系统会按容量把音符重排，乐句边界会错位。',
        // 和声这条必须在 user prompt 里也出现一次：模型强跟 user prompt、弱跟 system prompt
        // （实测：只有 system 写了和声时，连续两轮输出 chordGroup 数量都是 0）
        '织体：默认要有和声——每 2-3 小节至少 1 处，用 chordGroup 表示（强拍双音 / 乐句收束的和弦落音 / 分解和弦），不要整段都是单音。',
    ].join('\n'));

    // 2) 风格：决定用什么音乐语言
    if (styleHint) {
        parts.push(`## 风格要求（${styleOpt?.label ?? options.style}）\n${styleHint}`);
    }

    // 3) 密度：决定音符疏密与长短，与风格是两个维度，需同时满足
    if (densityHint) {
        parts.push(`## 密度要求（${densityOpt?.label ?? options.density}）\n${densityHint}`);
    }

    // 4) 额外要求放末尾（长上下文里靠后的更易被遵守），语义不变：压过以上全部
    // 并显式说明它能推翻系统提示词里的默认取向 —— 这是唯一每次必然送达、且用户可控的注入点
    if (options.extraPrompt) {
        parts.push(
            '## 额外要求（优先级最高，与以上任何要求冲突时以本段为准）\n' +
            '⚠️ 本段可整体推翻前面的默认取向（和声织体 / 节奏 / 技法 / 音区），例如写「只弹单音」就完全不要用 chordGroup：\n' +
            options.extraPrompt,
        );
    }

    parts.push('请直接输出 JSON，不要包裹在 markdown 代码块中。');

    return parts.join('\n\n');
}

export interface GenerationOptions {
    numMeasures: number;
    scaleType: string;
    style: string;
    density: string;
    extraPrompt?: string;
}

export { SYSTEM_PROMPT, DEFAULT_EXPERT_PROMPT };
