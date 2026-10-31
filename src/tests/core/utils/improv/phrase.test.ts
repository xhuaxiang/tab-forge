/**
 * phrase — 乐句计划覆盖、角色、动机派生与确定性测试。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type { LocalStyle, PhrasePlan } from '../../../../core/types/improv.ts';
import { LOCAL_STYLES } from '../../../../core/types/improv.ts';
import {
    buildPhrasePlan,
    phraseForMeasure,
    validatePhrasePlan,
} from '../../../../core/utils/improv/phrase.ts';
import { createRng } from '../../../../core/utils/improv/random.ts';
import { makeOptions } from './testOptions.ts';

function build(
    style: LocalStyle,
    numMeasures: number,
    seed: number,
): PhrasePlan[] {
    const options = makeOptions({ numMeasures, style, seed });
    return buildPhrasePlan(
        options,
        LOCAL_IMPROV_CONFIG.styleProfiles[style],
        LOCAL_IMPROV_CONFIG.playability,
        createRng(seed + 4),
    );
}

function clonePlan(phrases: readonly PhrasePlan[]): PhrasePlan[] {
    return phrases.map(phrase => ({ ...phrase, steps: [...phrase.steps] }));
}

/** 连续 3 步是否同向（0 步不算方向） */
function hasThreeSameDirection(steps: readonly number[]): boolean {
    for (let index = 2; index < steps.length; index++) {
        const first = Math.sign(steps[index - 2]);
        const second = Math.sign(steps[index - 1]);
        const third = Math.sign(steps[index]);
        if (first !== 0 && first === second && second === third) return true;
    }
    return false;
}

describe('buildPhrasePlan', () => {
    it('2–16 小节全覆盖：句界连续、角色合法、校验通过', () => {
        for (const style of LOCAL_STYLES) {
            const profile = LOCAL_IMPROV_CONFIG.styleProfiles[style];
            for (const numMeasures of [2, 3, 4, 6, 8, 16]) {
                for (let seed = 1; seed <= 3; seed++) {
                    const options = makeOptions({ numMeasures, style, seed });
                    const phrases = build(style, numMeasures, seed);

                    expect(validatePhrasePlan(phrases, options)).toEqual([]);
                    expect(phrases).toHaveLength(Math.ceil(
                        numMeasures / profile.phrase.measures,
                    ));
                    expect(phrases[0].startMeasure).toBe(0);
                    expect(phrases[phrases.length - 1].endMeasure).toBe(numMeasures);

                    phrases.forEach((phrase, index) => {
                        expect(phrase.index).toBe(index);
                        expect(phrase.endMeasure).toBeGreaterThan(phrase.startMeasure);
                        expect(phrase.steps).toHaveLength(profile.motifLength);
                        expect(phrase.sourcePhrase).toBe(index === 0 ? null : 0);
                        if (index > 0) {
                            expect(phrases[index - 1].endMeasure)
                                .toBe(phrase.startMeasure);
                        }
                    });

                    expect(phrases[0].role).toBe('statement');
                    if (phrases.length > 1) {
                        expect(phrases[phrases.length - 1].role).toBe('cadence');
                    }
                    for (let index = 1; index < phrases.length - 1; index++) {
                        expect(phrases[index].role)
                            .toBe(index % 2 === 1 ? 'answer' : 'development');
                    }
                }
            }
        }
    });

    it('把位窗口落在风格偏好 ∩ 可演奏范围内，且不宽于一个手距', () => {
        const playability = LOCAL_IMPROV_CONFIG.playability;
        const maxSpan = Math.max(3, playability.maxHandSpan + 1);

        for (const style of LOCAL_STYLES) {
            const profile = LOCAL_IMPROV_CONFIG.styleProfiles[style];
            const baseMin = Math.max(playability.fretMin, profile.preferredFretMin);
            const baseMax = Math.min(playability.fretMax, profile.preferredFretMax);

            for (let seed = 1; seed <= 10; seed++) {
                for (const phrase of build(style, 8, seed)) {
                    expect(phrase.fretMin).toBeGreaterThanOrEqual(baseMin);
                    expect(phrase.fretMax).toBeLessThanOrEqual(baseMax);
                    expect(phrase.fretMin).toBeLessThanOrEqual(phrase.fretMax);
                    expect(phrase.fretMax - phrase.fretMin + 1)
                        .toBeLessThanOrEqual(maxSpan);
                }
            }
        }
    });

    it('development 使用偏好范围的高把位窗口', () => {
        const playability = LOCAL_IMPROV_CONFIG.playability;
        for (const style of LOCAL_STYLES) {
            const profile = LOCAL_IMPROV_CONFIG.styleProfiles[style];
            const baseMax = Math.min(playability.fretMax, profile.preferredFretMax);
            for (let seed = 1; seed <= 5; seed++) {
                const phrases = build(style, 8, seed);
                const development = phrases.find(phrase => phrase.role === 'development');
                expect(development).toBeDefined();
                expect(development!.fretMax).toBe(baseMax);
            }
        }
    });

    it('动机派生：answer/cadence 保留句头，inversion 反向，sequence 原样', () => {
        for (const style of LOCAL_STYLES) {
            for (let seed = 1; seed <= 20; seed++) {
                const phrases = build(style, 16, seed);
                const base = phrases[0].steps;
                const headLength = Math.max(1, Math.ceil(base.length / 2));

                for (const phrase of phrases.slice(1)) {
                    if (phrase.variation === 'tail' || phrase.variation === 'cadence') {
                        expect(phrase.steps.slice(0, headLength))
                            .toEqual(base.slice(0, headLength));
                    } else if (phrase.variation === 'inversion') {
                        expect(phrase.steps).toEqual(base.map(step => -step));
                    } else {
                        expect(phrase.steps).toEqual(base);
                    }
                }
            }
        }
    });

    it('句尾固定为 cadence，且收尾级数向低音方向生成', () => {
        for (const style of LOCAL_STYLES) {
            for (let seed = 1; seed <= 10; seed++) {
                const phrases = build(style, 8, seed);
                const last = phrases[phrases.length - 1];
                expect(last.role).toBe('cadence');
                expect(last.variation).toBe('cadence');
            }
        }
    });

    it('基准动机不会出现连续三步同向', () => {
        for (const style of LOCAL_STYLES) {
            for (let seed = 1; seed <= 30; seed++) {
                const [statement] = build(style, 4, seed);
                expect(hasThreeSameDirection(statement.steps)).toBe(false);
            }
        }
    });

    it('同 seed 计划完全一致', () => {
        for (const style of LOCAL_STYLES) {
            expect(build(style, 8, 7)).toEqual(build(style, 8, 7));
        }
    });

    it('phraseForMeasure 覆盖每个小节，越界回落到最后一句', () => {
        const phrases = build('Jazz', 8, 2);
        for (let measureIndex = 0; measureIndex < 8; measureIndex++) {
            const phrase = phraseForMeasure(phrases, measureIndex);
            expect(measureIndex).toBeGreaterThanOrEqual(phrase.startMeasure);
            expect(measureIndex).toBeLessThan(phrase.endMeasure);
        }
        expect(phraseForMeasure(phrases, 99)).toBe(phrases[phrases.length - 1]);
    });
});

describe('validatePhrasePlan', () => {
    const options = makeOptions({ numMeasures: 8 });

    it('合法的计划没有错误', () => {
        expect(validatePhrasePlan(build('Jazz', 8, 1), options)).toEqual([]);
    });

    it('空计划报错', () => {
        expect(validatePhrasePlan([], options)).toEqual(['乐句计划为空']);
    });

    it('句界空洞与起始错误会被检出', () => {
        const phrases = clonePlan(build('Jazz', 8, 1));
        phrases[1].startMeasure += 1;
        expect(validatePhrasePlan(phrases, options).length).toBeGreaterThan(0);
    });

    it('首句非 statement、末句非 cadence 会被检出', () => {
        const first = clonePlan(build('Jazz', 8, 1));
        first[0].role = 'answer';
        expect(validatePhrasePlan(first, options))
            .toContain('第一句必须是 statement');

        const last = clonePlan(build('Jazz', 8, 1));
        last[last.length - 1].role = 'development';
        expect(validatePhrasePlan(last, options))
            .toContain('最后一句必须是 cadence');
    });

    it('非法把位窗口与空级数步会被检出', () => {
        const badWindow = clonePlan(build('Jazz', 8, 1));
        badWindow[0].fretMin = 20;
        badWindow[0].fretMax = 3;
        expect(validatePhrasePlan(badWindow, options).some(error =>
            error.includes('把位窗口非法'))).toBe(true);

        const noSteps = clonePlan(build('Jazz', 8, 1));
        noSteps[0].steps = [];
        expect(validatePhrasePlan(noSteps, options))
            .toContain('第 1 句没有级数步');
    });

    it('动机来源必须指向更早的乐句', () => {
        const phrases = clonePlan(build('Jazz', 8, 1));
        phrases[1].sourcePhrase = 2;
        expect(validatePhrasePlan(phrases, options).some(error =>
            error.includes('动机来源非法'))).toBe(true);
    });

    it('覆盖小节数与选项不一致会被检出', () => {
        const phrases = clonePlan(build('Jazz', 8, 1));
        const shorter = makeOptions({ numMeasures: 6 });
        expect(validatePhrasePlan(phrases, shorter).some(error =>
            error.includes('期望 6'))).toBe(true);
    });
});
