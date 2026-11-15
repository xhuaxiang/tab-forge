/**
 * promptTriggers — 隐藏提示词编辑器的触发词判断。
 */

import { describe, it, expect } from 'vitest';
import {
    isSystemPromptTrigger,
    TRIGGER_EXTRA_PROMPT,
} from '../../../features/ai/promptTriggers.ts';

describe('isSystemPromptTrigger', () => {
    it('精确等于触发词（允许首尾空白）才命中', () => {
        expect(isSystemPromptTrigger(TRIGGER_EXTRA_PROMPT)).toBe(true);
        expect(isSystemPromptTrigger(`  ${TRIGGER_EXTRA_PROMPT}\n`)).toBe(true);
    });

    it('包含触发词但带其他内容不算命中', () => {
        expect(isSystemPromptTrigger(`${TRIGGER_EXTRA_PROMPT}一下`)).toBe(false);
        expect(isSystemPromptTrigger(`请${TRIGGER_EXTRA_PROMPT}`)).toBe(false);
    });

    it('空值 / undefined 不命中', () => {
        expect(isSystemPromptTrigger('')).toBe(false);
        expect(isSystemPromptTrigger('   ')).toBe(false);
        expect(isSystemPromptTrigger()).toBe(false);
    });
});
