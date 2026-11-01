/**
 * 谱面显示模式配置的收敛测试。
 *
 * `#displayModeSelect` 的 option value 与 DISPLAY_MODES 必须对齐，
 * 不合法值会被 isDisplayMode 拦下（调用方据此不切换）。
 */

import { describe, it, expect } from 'vitest';
import { DISPLAY_MODES, DEFAULT_DISPLAY_MODE, isDisplayMode } from '../../core/config.ts';

describe('显示模式配置', () => {
    it('默认模式在取值表内', () => {
        expect(DISPLAY_MODES).toContain(DEFAULT_DISPLAY_MODE);
    });

    it('isDisplayMode 只接受取值表内的值', () => {
        for (const v of DISPLAY_MODES) {
            expect(isDisplayMode(v)).toBe(true);
        }
        expect(isDisplayMode('score')).toBe(false);
        expect(isDisplayMode('')).toBe(false);
        expect(isDisplayMode(null)).toBe(false);
        expect(isDisplayMode(undefined)).toBe(false);
    });
});
