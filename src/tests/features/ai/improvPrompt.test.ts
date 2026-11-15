/**
 * improvPrompt — 两段式提示词的机器契约拼接/剥离。
 *
 * 契约块必须由代码恒定追加且只出现一次；用户编辑的只是可编辑段，
 * 否则契约被改坏后解析会静默失败。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../core/config.ts';
import {
    FINGERING_PATTERNS,
    PRACTICE_FOCUSES,
} from '../../../core/types/improv/index.ts';
import {
    BRIEF_CONTRACT,
    BRIEF_CONTRACT_HEADING,
    composeBriefSystemPrompt,
    DEFAULT_BRIEF_PROMPT,
    DEFAULT_BRIEF_SYSTEM_PROMPT,
    stripBriefContract,
} from '../../../features/ai/improvBriefPrompt.ts';
import {
    PATCH_CONTRACT,
    PATCH_CONTRACT_HEADING,
    composePatchSystemPrompt,
    DEFAULT_PATCH_PROMPT,
    DEFAULT_PATCH_SYSTEM_PROMPT,
    stripPatchContract,
} from '../../../features/ai/improvPatchPrompt.ts';
import { AI_TECHNIQUES } from '../../../features/ai/contractConstants.ts';

function count(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

describe('brief prompt', () => {
    it('默认 system prompt = 可编辑段 + 契约，且契约只出现一次', () => {
        expect(DEFAULT_BRIEF_SYSTEM_PROMPT)
            .toBe(`${DEFAULT_BRIEF_PROMPT}\n\n${BRIEF_CONTRACT}`);
        expect(count(DEFAULT_BRIEF_SYSTEM_PROMPT, BRIEF_CONTRACT_HEADING)).toBe(1);
    });

    it('自定义提示词同样恒定追加契约', () => {
        const composed = composeBriefSystemPrompt('只解析调性与指型。');
        expect(composed.startsWith('只解析调性与指型。')).toBe(true);
        expect(composed.endsWith(BRIEF_CONTRACT)).toBe(true);
        expect(count(composed, BRIEF_CONTRACT_HEADING)).toBe(1);
    });

    it('空白自定义回落到默认提示词', () => {
        expect(composeBriefSystemPrompt('   '))
            .toBe(DEFAULT_BRIEF_SYSTEM_PROMPT);
        expect(composeBriefSystemPrompt()).toBe(DEFAULT_BRIEF_SYSTEM_PROMPT);
    });

    it('strip 去掉契约且不留下多余空行', () => {
        expect(stripBriefContract(DEFAULT_BRIEF_SYSTEM_PROMPT))
            .toBe(DEFAULT_BRIEF_PROMPT);
        const custom = '自定义需求解析说明';
        expect(stripBriefContract(composeBriefSystemPrompt(custom))).toBe(custom);
        expect(stripBriefContract('没有契约的文本')).toBe('没有契约的文本');
    });

    it('strip 后再 compose 不会重复契约', () => {
        const edited = stripBriefContract(DEFAULT_BRIEF_SYSTEM_PROMPT);
        const recomposed = composeBriefSystemPrompt(edited);
        expect(recomposed).toBe(DEFAULT_BRIEF_SYSTEM_PROMPT);
        expect(count(recomposed, BRIEF_CONTRACT_HEADING)).toBe(1);
    });

    it('CAGED 映射与标准五型对齐', () => {
        expect(DEFAULT_BRIEF_PROMPT).toContain('C 型≈Mi');
        expect(DEFAULT_BRIEF_PROMPT).toContain('A 型≈Sol');
        expect(DEFAULT_BRIEF_PROMPT).toContain('G 型≈La');
        expect(DEFAULT_BRIEF_PROMPT).toContain('E 型≈Si');
        expect(DEFAULT_BRIEF_PROMPT).toContain('D 型≈Re');
        expect(DEFAULT_BRIEF_PROMPT).not.toContain('E 型≈Mi');
    });

    it('契约里的取值来自 core 常量，不另写一份', () => {
        for (const pattern of FINGERING_PATTERNS) {
            expect(BRIEF_CONTRACT).toContain(`"${pattern}"`);
        }
        for (const focus of PRACTICE_FOCUSES) {
            expect(BRIEF_CONTRACT).toContain(`"${focus}"`);
        }
    });
});

describe('patch prompt', () => {
    it('默认 system prompt = 可编辑段 + 契约，且契约只出现一次', () => {
        expect(DEFAULT_PATCH_SYSTEM_PROMPT)
            .toBe(`${DEFAULT_PATCH_PROMPT}\n\n${PATCH_CONTRACT}`);
        expect(count(DEFAULT_PATCH_SYSTEM_PROMPT, PATCH_CONTRACT_HEADING)).toBe(1);
    });

    it('自定义提示词同样恒定追加契约', () => {
        const composed = composePatchSystemPrompt('少加花，保持音高清晰。');
        expect(composed.startsWith('少加花，保持音高清晰。')).toBe(true);
        expect(composed.endsWith(PATCH_CONTRACT)).toBe(true);
        expect(count(composed, PATCH_CONTRACT_HEADING)).toBe(1);
    });

    it('strip 后重新 compose 不会重复契约', () => {
        const custom = '自定义表现扩展说明';
        const stripped = stripPatchContract(composePatchSystemPrompt(custom));
        expect(stripped).toBe(custom);
        expect(composePatchSystemPrompt(stripped))
            .toBe(`${custom}\n\n${PATCH_CONTRACT}`);
        expect(stripPatchContract('没有契约的文本')).toBe('没有契约的文本');
    });

    it('契约里的技法白名单与解析器共用同一来源', () => {
        for (const technique of AI_TECHNIQUES) {
            expect(PATCH_CONTRACT).toContain(`"${technique}"`);
        }
        expect(PATCH_CONTRACT).toContain('measureIndex');
        expect(PATCH_CONTRACT).toContain('slotIndex');
        expect(PATCH_CONTRACT).toContain('targetFret');
    });

    it('泛音触弦点只列可演奏白名单里的值', () => {
        const choices = LOCAL_IMPROV_CONFIG.playability.harmonicFrets;
        expect(PATCH_CONTRACT).toContain(choices.join(' / '));
        // 提示词不能再承诺 1-24 整段
        expect(PATCH_CONTRACT).not.toContain('1-24');
    });
});
