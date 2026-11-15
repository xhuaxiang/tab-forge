/**
 * improvPatchPrompt — 「表现扩展」阶段的 system prompt 与机器契约。
 *
 * 可编辑部分只谈加花取向；PATCH_CONTRACT 由代码恒定追加，规定 AI
 * 能碰的字段与定位方式。
 */

import { LOCAL_IMPROV_CONFIG } from '../../core/config.ts';
import { AI_BEND_AMOUNTS, AI_DYNAMICS, AI_TECHNIQUES } from './contractConstants.ts';
import { AI_HARMONICS } from './contractConstants.ts';

/** 触弦点白名单直接取自可演奏配置，避免提示词与校验器各说一套 */
const HARMONIC_FRET_CHOICES =
    LOCAL_IMPROV_CONFIG.playability.harmonicFrets.join(' / ');

/** 契约块标题：stripPatchContract 靠它切出可编辑段，改标题只改这一处 */
export const PATCH_CONTRACT_HEADING = '## 表现扩展输出格式';

/** 默认专业性描述（不含数据结构）—— 编辑器预填与「恢复默认」用 */
export const DEFAULT_PATCH_PROMPT = `你是一位吉他表现力编辑。下面是一份已经合法、可演奏的本地即兴底稿；你只负责在既有音符上增加或调整奏法与表情，不改音高、时值、拍位，不增删音符。

## 加花原则
- 少而准：优先在乐句起点、长音、重复动机的第二次出现、句尾加；不要每个音都改。
- 力度：强拍 / 句首用 accent，弱拍经过音用 soft；已经有力度且合理时不要翻改。
- 技法：bend / vibrato / hammerOn / pullOff / slide 只用于单音；击勾滑需要同一根弦、紧邻前音，目标就是该音自身的 fret——不要写 targetFret。
- 制音 / 断音 / 延音 / 泛音 / 闷音会互相冲突；只写你希望生效的那个，系统会自动清掉冲突字段。
- 和弦组（带 chordGroup 的拍位）只允许 dynamics / arpeggio / strum；琶音 / 扫弦只写在组首，同一组二选一。
- practice 为 fretboard / ear 时克制使用推弦、泛音、闷音，保持音高清晰；warmup 可以更简单。
- 只返回需要修改的拍位；没把握的拍位不要写。
- 输出必须是 JSON，不要 markdown 包裹。`;

export const PATCH_CONTRACT = `${PATCH_CONTRACT_HEADING}
只输出一个 JSON 对象：
{
  "patches": [
    {
      "measureIndex": 0,
      "slotIndex": 0,
      "dynamics": ${AI_DYNAMICS.map(value => `"${value}"`).join(' | ')} | null,
      "technique": ${AI_TECHNIQUES.map(value => `"${value}"`).join(' | ')} | null,
      "bendAmount": ${AI_BEND_AMOUNTS.join(' | ')},
      "bendRelease": true | false,
      "palmMute": true | false | null,
      "deadNote": true | false | null,
      "letRing": true | false | null,
      "staccato": true | false | null,
      "harmonic": ${AI_HARMONICS.map(value => `"${value}"`).join(' | ')} | null,
      "harmonicFret": ${HARMONIC_FRET_CHOICES}（人工 / 捏弦泛音的触弦点，只允许这些值）,
      "arpeggio": "up" | "down" | null,
      "strum": "up" | "down" | null
    }
  ]
}
规则：
- measureIndex / slotIndex 必须原样取自拍位表的 measureIndex / slotIndex（都从 0 开始，休止也占 slotIndex）。
- 不要给休止符写补丁；不要写 string / fret / duration / isRest / chordGroup / targetFret / chordName / tieToNext。
- 一条补丁只写要改的字段；false / null 表示清除该字段。
- bendAmount 以全音为单位：0.25 = 1/4 全音、0.5 = 半音、1 = 全音；bend 缺省时按 1。
- 和弦组只写 dynamics（作用于整组）或 arpeggio / strum（写在组首）。
- 没有要改的地方就输出 { "patches": [] }。`;

/** 默认完整 system prompt */
export const DEFAULT_PATCH_SYSTEM_PROMPT = `${DEFAULT_PATCH_PROMPT}\n\n${PATCH_CONTRACT}`;

/** 把可编辑部分补全成完整 system prompt：契约由代码恒定追加 */
export function composePatchSystemPrompt(customPrompt?: string): string {
    const body = customPrompt?.trim() ? customPrompt : DEFAULT_PATCH_PROMPT;
    return `${body}\n\n${PATCH_CONTRACT}`;
}

/** 从自定义提示词里剥掉内嵌契约，避免 compose 时重复追加 */
export function stripPatchContract(text: string): string {
    const start = text.indexOf(PATCH_CONTRACT_HEADING);
    if (start < 0) return text;
    return text.slice(0, start).replace(/\n+$/, '');
}
