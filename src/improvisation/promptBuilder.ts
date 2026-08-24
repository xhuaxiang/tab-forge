/**
 * promptBuilder — 根据乐谱状态构建 DeepSeek AI 的 prompt
 *
 * 将所有用户上下文（调性、BPM、拍号、调弦等）注入 system/user prompt，
 * 要求 AI 返回严格符合 Note[] 结构的 JSON。
 */

import type { TabScore } from '../types/index.ts';

// ---- System Prompt ----
const SYSTEM_PROMPT = `你是一位精通吉他即兴演奏的 AI 音乐助手。
你需要为六线谱（Tablature）生成即兴独奏音符，输出必须为合法 JSON。

## 音符对象格式
每个音符是一个 JSON 对象，字段如下：
{
  "string": 数字,    // 弦号 1-6（1=高音E最细, 6=低音E最粗）
  "fret": 数字,      // 品位 0-24（0=空弦）
  "duration": 数字,  // 时值: 1=全音符, 0.5=二分, 0.25=四分, 0.125=八分, 0.0625=十六分, 0.03125=三十二分
  "isRest": 布尔,    // 是否为休止符（可选）
  "technique": "hammerOn" | "pullOff" | "slide" | null,  // 技法（可选）
  "targetFret": 数字, // 技法目标品位（可选，仅当有时才需要）
  "tieToNext": 布尔,  // 是否延音到下一拍（可选）
  "chordGroup": 数字, // 同一和弦内的音符共享相同数字，单音不需要（可选）
  "arpeggio": "up" | "down" | null,  // 琶音方向（可选）
  "strum": "up" | "down" | null      // 扫弦方向（可选）
}

## 输出格式
{
  "measures": [
    { "notes": [ 音符对象, ... ] },
    ...
  ]
}

## 节奏多样性（最重要，严格遵守）
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
- 优先使用相邻弦的临近品位（手型自然），适当换把位制造音色变化
- 步进移动为主（7-12 品），偶尔跳进（1-7 品）
- 适当加入空弦音增加色彩
- 小节数不要太少，三到四个小节起步
- 结尾音尽量回到主音并给足时值`;

// ---- 密度 → 时值分布配置 ----
const DENSITY_RHYTHM: Record<string, string> = {
    '低': '以长音为主：二分(0.5)和四分(0.25)占多数，每小节 2-4 个音，偶尔用八分(0.125)加花，休止符要多。',
    '中': '以四分(0.25)和八分(0.125)为主体，穿插少量十六分(0.0625)作为装饰音，每小节 4-6 个音，节奏有松有紧。',
    '高': '以八分(0.125)和十六分(0.0625)为主，十六分跑动形成快速乐句，乐句尾用长音(0.25或0.5)收束，密度大但要有呼吸。',
};

// ---- 风格 → 节奏性格 ----
const STYLE_RHYTHM: Record<string, string> = {
    'Jazz': '摇摆感：八分音符为主，加入切分和"长-短-短"型节奏，和弦音与经过音交替。',
    'Blues': '布鲁斯感：三连音律动，大量 bent/slide 味道的邻音游移，呼应式短句。',
    'Rock': '摇滚感：强拍强调，八分/十六分驱动，riff 式重复动机+变奏。',
    'Folk': '民谣感：律动平稳，四分/八分为主，旋律歌唱性强，多用双音与和弦琶音。',
    'Classical': '古典感：均匀流畅，琶音与音阶跑动，强弱起伏，乐句规整。',
};

// ---- Build User Prompt ----
export function buildUserPrompt(score: TabScore, options: GenerationOptions): string {
    const { measures: existingMeasures, tuning, bpm, key: scoreKey, timeSignature } = score;

    const tuningStr = [
        `1弦=${tuning.string1}`,
        `2弦=${tuning.string2}`,
        `3弦=${tuning.string3}`,
        `4弦=${tuning.string4}`,
        `5弦=${tuning.string5}`,
        `6弦=${tuning.string6}`,
    ].join(', ');

    const parts: string[] = [];
    parts.push(`请生成 ${options.numMeasures} 小节吉他即兴独奏。`);
    parts.push(`- 调性: ${scoreKey || 'C'}`);
    parts.push(`- 音阶类型: ${options.scaleType}`);
    parts.push(`- BPM: ${bpm}`);
    parts.push(`- 拍号: ${timeSignature}`);
    parts.push(`- 调弦: ${tuningStr}`);
    parts.push(`- 风格: ${options.style}`);
    parts.push(`- 音符密度: ${options.density}`);

    // 密度对应的时值分布要求
    const densityHint = DENSITY_RHYTHM[options.density] ?? DENSITY_RHYTHM['中'];
    parts.push(`- 密度节奏要求: ${densityHint}`);

    // 风格对应的节奏性格
    const styleHint = STYLE_RHYTHM[options.style];
    if (styleHint) {
        parts.push(`- 风格节奏要求: ${styleHint}`);
    }

    parts.push('\n⚠️ 硬性要求：务必让每个音符的 duration 有所变化，绝不能所有音符时长相同；每小节时长总和要等于拍号总拍数。');

    if (existingMeasures.length > 0) {
        parts.push(`\n当前乐谱已有 ${existingMeasures.length} 个小节，请在末尾延续风格，并沿用其节奏/技法特色。`);
    }

    if (options.extraPrompt) {
        parts.push(`\n额外要求: ${options.extraPrompt}`);
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

export { SYSTEM_PROMPT };