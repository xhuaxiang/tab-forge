/**
 * noteContract — system prompt 的「数据结构」部分（机器契约）
 *
 * 只放 AI 输出必须严格遵守的结构定义：音符对象字段 + 顶层输出格式。
 * 「专业性描述」（人格 / 节奏 / 旋律 / 演奏约束）在 promptBuilder.ts ——
 * 改那边只影响生成质量，改这边则直接决定数据能否被解析落库。
 *
 * ⚠️ 本文件的字段与取值必须与 responseParser.ts 的校验保持一致：
 *   sanitizeNote 只认它白名单里的字段/技法，对不上的会被丢弃。
 *   尤其是 `technique`：这里改取值，必须同步 responseParser.ts 的 `AI_TECHNIQUES`，
 *   否则 AI 发的技法会被忽略（该处已加 console.warn 留痕，但仍然是漏的）。
 */

/** 音符对象格式 + 顶层输出格式 */
export const NOTE_CONTRACT = `## 音符对象格式
每个音符是一个 JSON 对象，字段如下：
{
  "string": 数字,    // 弦号 1-6（1=高音E最细, 6=低音E最粗）
  "fret": 数字,      // 品位 0-24（0=空弦）
  "duration": 数字,  // 时值: 1=全音符, 0.5=二分, 0.25=四分, 0.125=八分, 0.0625=十六分, 0.03125=三十二分
  "isRest": 布尔,    // 是否为休止符（可选）
  "technique": "hammerOn" | "pullOff" | "slide" | "bend" | "vibrato" | null,  // 技法（可选）
  "targetFret": 数字, // 击弦/勾弦/滑弦的目标品位（可选，仅这几样需要）
  "bendAmount": 数字, // 推弦幅度（半音）: 0.25=1/4音, 0.5=1/2音, 1=全音（仅 technique="bend" 时用）
  "bendRelease": 布尔, // 推弦后是否释放回原音（仅 technique="bend" 时用）
  "dynamics": "soft" | "accent" | null, // 力度：accent=重音（强拍/句首），soft=轻音（弱拍/经过音），不写=普通（可选）
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

## 示例（4/4 一小节：分解和弦起句 → 单音 → 推弦 → 重音收束）
{
  "measures": [
    { "notes": [
      { "string": 1, "fret": 5, "duration": 0.25, "chordGroup": 1, "arpeggio": "up", "dynamics": "accent" },
      { "string": 2, "fret": 5, "duration": 0.25, "chordGroup": 1 },
      { "string": 3, "fret": 5, "duration": 0.25, "chordGroup": 1 },
      { "string": 2, "fret": 8, "duration": 0.25, "technique": "bend", "bendAmount": 1 },
      { "string": 1, "fret": 8, "duration": 0.25, "dynamics": "soft" },
      { "string": 3, "fret": 7, "duration": 0.25, "dynamics": "accent" }
    ]}
  ]
}
上面三个共享 chordGroup: 1 的音构成**一个**拍位（只占 0.25，不是三个 0.25），arpeggio 写在组首。`;
