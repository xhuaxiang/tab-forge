/**
 * promptBuilder 测试 —— 系统提示词的拆分与拼装
 *
 * 覆盖两点：
 *   ① composeSystemPrompt 恒定追加数据结构，用户改不到契约
 *   ② stripContract 能把旧版「专业性描述 + 契约」整段剥成专业性描述，不产生重复契约
 */
import { describe, it, expect } from 'vitest';
import {
    composeSystemPrompt, stripContract, DEFAULT_EXPERT_PROMPT,
} from '../../../features/ai/promptBuilder.ts';
import { NOTE_CONTRACT } from '../../../features/ai/noteContract.ts';

describe('composeSystemPrompt', () => {
    it('默认拼装 = 专业性描述 + 数据结构', () => {
        expect(composeSystemPrompt()).toBe(`${DEFAULT_EXPERT_PROMPT}\n\n${NOTE_CONTRACT}`);
    });

    it('传自定义专业性描述时，数据结构仍然被追加', () => {
        const composed = composeSystemPrompt('只弹五声音阶。');
        expect(composed).toBe(`只弹五声音阶。\n\n${NOTE_CONTRACT}`);
        expect(composed).toContain('## 音符对象格式');
    });

    it('传空/纯空白时回退到默认专业性描述', () => {
        expect(composeSystemPrompt('')).toBe(composeSystemPrompt());
        expect(composeSystemPrompt('   \n  ')).toBe(composeSystemPrompt());
    });
});

describe('stripContract', () => {
    it('旧版整段（人格 + 契约 + 演奏要求）剥成专业性描述', () => {
        const persona = '你是一位精通吉他即兴演奏的 AI 音乐助手。';
        const expertTail = DEFAULT_EXPERT_PROMPT.slice(DEFAULT_EXPERT_PROMPT.indexOf('## 节奏多样性'));
        const legacySaved = `${persona}\n\n${NOTE_CONTRACT}\n\n${expertTail}`;

        const stripped = stripContract(legacySaved);
        expect(stripped).toBe(`${persona}\n\n${expertTail}`);
        expect(stripped).not.toContain('## 音符对象格式');
    });

    it('剥离后重新拼装不会出现两份数据结构', () => {
        const legacySaved = `${DEFAULT_EXPERT_PROMPT}\n\n${NOTE_CONTRACT}`;
        const composed = composeSystemPrompt(stripContract(legacySaved));
        expect(composed.match(/## 音符对象格式/g)).toHaveLength(1);
    });

    it('不含数据结构的文本原样返回', () => {
        expect(stripContract(DEFAULT_EXPERT_PROMPT)).toBe(DEFAULT_EXPERT_PROMPT);
    });
});
