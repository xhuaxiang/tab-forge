/**
 * rhythm — 容量精确闭合与角色标记测试。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type { NoteDuration } from '../../../../core/types/index.ts';
import { NOTE_DURATIONS } from '../../../../core/types/index.ts';
import type {
    LocalStyle,
    ResolvedImprovOptions,
    StyleProfile,
} from '../../../../core/types/improv.ts';
import { LOCAL_DENSITIES, LOCAL_STYLES } from '../../../../core/types/improv.ts';
import { capacityFromTimeSignature } from '../../../../core/utils/measureUtils.ts';
import { buildPhrasePlan } from '../../../../core/utils/improv/phrase.ts';
import { buildRhythmPlan, canFill } from '../../../../core/utils/improv/rhythm.ts';
import { createRng } from '../../../../core/utils/improv/random.ts';
import { makeOptions } from './testOptions.ts';

describe('buildRhythmPlan', () => {
    it('9 个拍号 × 3 个密度 × 20 个 seed 都精确闭合', () => {
        for (const signature of LOCAL_IMPROV_CONFIG.timeSignatures) {
            for (const density of LOCAL_DENSITIES) {
                for (let seed = 1; seed <= 20; seed++) {
                    const options = makeOptions({
                        numMeasures: 2,
                        timeSignature: signature,
                        density,
                        seed,
                    });
                    const plan = buildRhythmPlan(
                        options,
                        LOCAL_IMPROV_CONFIG.densityProfiles[density],
                        LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
                        createRng(seed),
                    );

                    expect(plan).toHaveLength(2);
                    const capacity = capacityFromTimeSignature(signature);
                    for (const measure of plan) {
                        expect(measure.capacity).toBeCloseTo(capacity, 9);
                        expect(measure.slots.length).toBeGreaterThan(0);
                        expect(measure.slots.some(slot => !slot.isRest)).toBe(true);
                        expect(measure.slots.filter(slot => !slot.isRest).length)
                            .toBeGreaterThanOrEqual(
                                LOCAL_IMPROV_CONFIG.densityProfiles[density]
                                    .minNotesPerMeasure,
                            );

                        let total = 0;
                        for (const slot of measure.slots) {
                            expect(NOTE_DURATIONS).toContain(slot.duration);
                            expect(slot.duration).toBeGreaterThan(0);
                            total += slot.duration;
                        }
                        expect(total).toBeCloseTo(capacity, 9);
                    }
                }
            }
        }
    });

    it('拍位不足时二分补足，密度下限不会被短小节破坏', () => {
        // 回归：4/4 中密度 seed 7 曾只抽出两个 0.5 拍位，发音数 2 < 3。
        for (const signature of ['2/4', '4/4']) {
            for (let seed = 1; seed <= 30; seed++) {
                const options = makeOptions({
                    numMeasures: 2,
                    timeSignature: signature,
                    density: '中',
                    seed,
                });
                const plan = buildRhythmPlan(
                    options,
                    LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
                    LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
                    createRng(seed),
                );
                for (const measure of plan) {
                    expect(measure.slots.filter(slot => !slot.isRest).length)
                        .toBeGreaterThanOrEqual(
                            LOCAL_IMPROV_CONFIG.densityProfiles['中']
                                .minNotesPerMeasure,
                        );
                }
            }
        }
    });

    it('每小节第一个拍位不是休止符，且是强拍', () => {
        const options = makeOptions({ numMeasures: 4, seed: 9 });
        const plan = buildRhythmPlan(
            options,
            LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
            LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
            createRng(options.seed),
        );
        for (const measure of plan) {
            expect(measure.slots[0].isRest).toBe(false);
            expect(measure.slots[0].role).toBe('strong');
        }
    });

    it('同 seed 结果完全相同，不同 seed 不保证相同', () => {
        const options = makeOptions({ numMeasures: 4, seed: 12 });
        const build = () => buildRhythmPlan(
            options,
            LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
            LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
            createRng(options.seed),
        );
        expect(build()).toEqual(build());
    });

    it('密度允许的 0.0625 时值会实际出现', () => {
        let sixteenths = 0;
        for (let seed = 1; seed <= 30; seed++) {
            const options = makeOptions({ numMeasures: 4, density: '中', seed });
            const plan = buildRhythmPlan(
                options,
                LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
                LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
                createRng(seed),
            );
            for (const measure of plan) {
                sixteenths += measure.slots.filter(slot => slot.duration === 0.0625).length;
            }
        }
        expect(sixteenths).toBeGreaterThan(0);
    });

    it('4/4 只有第 1、3 拍（offset 0、0.5）算强拍，反拍不算', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const options = makeOptions({
                numMeasures: 4, timeSignature: '4/4', density: '高', seed,
            });
            const plan = buildRhythmPlan(
                options,
                LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
                LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
                createRng(seed),
            );
            for (const measure of plan) {
                let offsetUnits = 0;
                for (const slot of measure.slots) {
                    const onBeat = offsetUnits % 8 === 0;
                    const expectedStrong = onBeat
                        && Math.floor(offsetUnits / 8) % 2 === 0;
                    expect(slot.role === 'strong').toBe(expectedStrong);
                    offsetUnits += Math.round(slot.duration * 32);
                }
            }
        }
    });

    it('复合拍号按 3 个八分一组、7/8 按 2+2+3 标强拍', () => {
        const expectedStrongBeat = (signature: string, units: number): boolean => {
            if (units % 4 !== 0) return false;
            const beatIndex = units / 4;
            if (signature === '6/8' || signature === '9/8' || signature === '12/8') {
                return beatIndex % 3 === 0;
            }
            if (signature === '7/8') {
                return beatIndex === 0 || beatIndex === 2 || beatIndex === 4;
            }
            throw new Error(`测试未覆盖拍号: ${signature}`);
        };

        for (const signature of ['6/8', '9/8', '12/8', '7/8']) {
            for (let seed = 1; seed <= 10; seed++) {
                const options = makeOptions({
                    numMeasures: 2, timeSignature: signature, density: '高', seed,
                });
                const plan = buildRhythmPlan(
                    options,
                    LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
                    LOCAL_IMPROV_CONFIG.styleProfiles[options.style],
                    createRng(seed),
                );
                for (const measure of plan) {
                    let offsetUnits = 0;
                    for (const slot of measure.slots) {
                        expect(slot.role === 'strong')
                            .toBe(expectedStrongBeat(signature, offsetUnits));
                        offsetUnits += Math.round(slot.duration * 32);
                    }
                }
            }
        }
    });

    it('canFill 对配置内所有容量成立', () => {
        for (const signature of LOCAL_IMPROV_CONFIG.timeSignatures) {
            const capacity = capacityFromTimeSignature(signature);
            for (const density of LOCAL_DENSITIES) {
                const durations: NoteDuration[] = [
                    ...LOCAL_IMPROV_CONFIG.densityProfiles[density].durations
                        .map(item => item.duration),
                    0.125,
                ];
                expect(canFill(capacity, Array.from(new Set(durations)))).toBe(true);
            }
        }
    });
});

describe('buildRhythmPlan（乐句感知）', () => {
    function phrasedPlan(
        styleName: LocalStyle,
        options: ResolvedImprovOptions,
        styleOverride?: StyleProfile,
        phraseSeed?: number,
    ) {
        const style = styleOverride
            ?? LOCAL_IMPROV_CONFIG.styleProfiles[styleName];
        const phrases = buildPhrasePlan(
            options, style, LOCAL_IMPROV_CONFIG.playability,
            createRng((phraseSeed ?? options.seed) + 4),
        );
        const plan = buildRhythmPlan(
            options,
            LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
            style,
            createRng(options.seed),
            phrases,
        );
        return { phrases, plan };
    }

    it('每个拍号 × 密度 × seed 仍精确闭合，并标注句归属', () => {
        for (const signature of LOCAL_IMPROV_CONFIG.timeSignatures) {
            for (const density of LOCAL_DENSITIES) {
                for (let seed = 1; seed <= 5; seed++) {
                    const options = makeOptions({
                        numMeasures: 8,
                        timeSignature: signature,
                        density,
                        seed,
                    });
                    const { phrases, plan } = phrasedPlan('Jazz', options);

                    expect(plan).toHaveLength(8);
                    const capacity = capacityFromTimeSignature(signature);
                    plan.forEach((measure, measureIndex) => {
                        const phrase = phrases.find(item =>
                            measureIndex >= item.startMeasure
                            && measureIndex < item.endMeasure);
                        expect(measure.phraseIndex).toBe(phrase!.index);
                        expect(measure.capacity).toBeCloseTo(capacity, 9);

                        let total = 0;
                        for (const slot of measure.slots) {
                            expect(NOTE_DURATIONS).toContain(slot.duration);
                            total += slot.duration;
                        }
                        expect(total).toBeCloseTo(capacity, 9);
                        expect(measure.slots[0].isRest).toBe(false);
                        expect(measure.slots[0].role).toBe('strong');
                        expect(measure.slots.filter(slot => !slot.isRest).length)
                            .toBeGreaterThanOrEqual(
                                LOCAL_IMPROV_CONFIG.densityProfiles[density]
                                    .minNotesPerMeasure,
                            );
                    });
                }
            }
        }
    });

    it('同 seed 的乐句节奏完全一致', () => {
        const options = makeOptions({ numMeasures: 8, seed: 11 });
        expect(phrasedPlan('Rock', options).plan)
            .toEqual(phrasedPlan('Rock', options).plan);
    });

    it('非末句句尾按概率留休止', () => {
        const baseStyle = LOCAL_IMPROV_CONFIG.styleProfiles.Jazz;
        const style: StyleProfile = {
            ...baseStyle,
            phrase: { ...baseStyle.phrase, endRestProbability: 1 },
        };
        let endRests = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const options = makeOptions({
                numMeasures: 8, timeSignature: '4/4', density: '高', seed,
            });
            const { phrases, plan } = phrasedPlan('Jazz', options, style);
            plan.forEach(measure => {
                const phrase = phrases.find(item =>
                    measure.index >= item.startMeasure
                    && measure.index < item.endMeasure)!;
                const isPhraseEnd = measure.index === phrase.endMeasure - 1;
                const isLastPhrase = phrase.index === phrases.length - 1;
                if (isPhraseEnd && !isLastPhrase
                    && measure.slots[measure.slots.length - 1].isRest) {
                    endRests++;
                }
            });
        }
        expect(endRests).toBeGreaterThan(0);
    });

    it('句内后续小节相对首小节产生节奏变体', () => {
        let varied = 0;
        for (const style of LOCAL_STYLES) {
            for (let seed = 1; seed <= 20; seed++) {
                const options = makeOptions({
                    numMeasures: 8, timeSignature: '4/4', density: '中', seed,
                });
                const { plan } = phrasedPlan(style, options);
                for (let measureIndex = 1; measureIndex < plan.length; measureIndex++) {
                    if (plan[measureIndex - 1].phraseIndex !== plan[measureIndex].phraseIndex) {
                        continue;
                    }
                    const before = plan[measureIndex - 1].slots
                        .map(slot => `${slot.duration}:${slot.isRest}`);
                    const after = plan[measureIndex].slots
                        .map(slot => `${slot.duration}:${slot.isRest}`);
                    if (before.join('|') !== after.join('|')) varied++;
                }
            }
        }
        expect(varied).toBeGreaterThan(0);
    });
});
