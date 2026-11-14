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
    RhythmMeasure,
    StyleProfile,
} from '../../../../core/types/improv/index.ts';
import { LOCAL_DENSITIES, LOCAL_STYLES } from '../../../../core/types/improv/index.ts';
import { capacityFromTimeSignature } from '../../../../core/utils/measureUtils.ts';
import { buildHarmonyPlan } from '../../../../core/utils/improv/harmony.ts';
import { buildPhrasePlan } from '../../../../core/utils/improv/phrase.ts';
import {
    applyCadence,
    buildRhythmPlan,
    canFill,
} from '../../../../core/utils/improv/rhythm.ts';
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

describe('applyCadence', () => {
    function measure(
        index: number,
        slots: Array<[NoteDuration, boolean]>,
        capacity = 1,
    ): RhythmMeasure {
        return {
            index,
            capacity,
            slots: slots.map(([duration, isRest]) => ({
                duration,
                isRest,
                role: 'weak',
            })),
        };
    }

    function shape(item: RhythmMeasure): Array<[number, boolean]> {
        return item.slots.map(slot => [slot.duration, slot.isRest]);
    }

    function total(item: RhythmMeasure): number {
        return item.slots.reduce((sum, slot) => sum + slot.duration, 0);
    }

    it('末音之后的休止不够时，从长音开始借时间延长末音', () => {
        const options = makeOptions({ numMeasures: 2, timeSignature: '4/4' });
        const plan = [
            measure(0, [[0.25, false], [0.25, false], [0.25, false], [0.25, true]]),
            measure(1, [[0.25, false], [0.25, false], [0.25, false], [0.25, false]]),
        ];
        const result = applyCadence(plan, options, undefined, 0.5);

        // 非末小节原样保留（引用也不新建）
        expect(result[0]).toBe(plan[0]);
        // 只缩短时值、不删音：三个前缀音都保留
        expect(shape(result[1])).toEqual([
            [0.25, false], [0.125, false], [0.125, false], [0.5, false],
        ]);
        expect(total(result[1])).toBeCloseTo(1, 9);
        expect(result[1].slots.filter(slot => !slot.isRest)).toHaveLength(4);
        // 收尾音落在最后一拍，重标为强拍
        expect(result[1].slots[3].role).toBe('strong');
    });

    it('优先吃末音之后的休止，不动前面的发音拍位', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4' });
        const plan = [
            measure(0, [[0.25, false], [0.25, false], [0.25, false], [0.25, true]]),
        ];
        const result = applyCadence(plan, options, undefined, 0.5);
        // 末音和它后面的休止一起并成 0.5 的收尾音，前缀原样保留
        expect(shape(result[0])).toEqual([
            [0.25, false], [0.25, false], [0.5, false],
        ]);
        expect(total(result[0])).toBeCloseTo(1, 9);
    });

    it('末音已经达到下限时原样返回', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4' });
        const plan = [
            measure(0, [[0.25, false], [0.25, false], [0.5, false]]),
        ];
        expect(applyCadence(plan, options, undefined, 0.5)).toBe(plan);
    });

    it('前缀都是最短时值时借不出时间，原样返回', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4' });
        const slots = Array.from(
            { length: 28 },
            () => [0.03125, false] as [NoteDuration, boolean],
        );
        slots.push([0.125, false]);
        const plan = [measure(0, slots)];
        // 前缀全是 1/32，无法再缩短，0.5 的终止音放不下
        expect(applyCadence(plan, options, undefined, 0.5)).toBe(plan);
    });

    it('前缀休止也能借时：缩短休止不改变发音数', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4' });
        const plan = [
            measure(0, [
                [0.125, false], [0.5, true], [0.25, false], [0.125, false],
            ]),
        ];
        const result = applyCadence(plan, options, undefined, 0.5);
        expect(shape(result[0])).toEqual([
            [0.125, false], [0.25, true], [0.125, false], [0.5, false],
        ]);
        expect(total(result[0])).toBeCloseTo(1, 9);
        expect(result[0].slots.filter(slot => !slot.isRest)).toHaveLength(3);
    });

    it('借时不会把发音压到 1/32 以下', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4' });
        const plan = [
            measure(0, [
                [0.5, false],
                [0.0625, false], [0.0625, false],
                [0.0625, false], [0.0625, false],
                [0.125, false], [0.125, false],
            ]),
        ];
        const result = applyCadence(plan, options, undefined, 0.5);
        expect(result[0].slots.every(slot => slot.duration >= 0.0625)).toBe(true);
        expect(total(result[0])).toBeCloseTo(1, 9);
    });

    it('借时把 1/16 休止整个并掉，结果不出现更短的休止', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4' });
        const plan = [
            measure(0, [
                [0.0625, true], [0.0625, false],
                [0.0625, false], [0.0625, false],
            ], 0.25),
        ];
        const result = applyCadence(plan, options, undefined, 0.125);
        // 前缀里唯一能借的是那个 0.0625 休止，整块并掉后容量仍精确闭合
        expect(shape(result[0])).toEqual([
            [0.0625, false], [0.0625, false], [0.125, false],
        ]);
        expect(result[0].slots.every(slot => slot.duration >= 0.0625)).toBe(true);
        expect(total(result[0])).toBeCloseTo(0.25, 9);
    });

    it('2/4 容量不足以放下终止时值时原样返回，容量仍闭合', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '2/4' });
        const plan = [measure(0, [[0.25, false], [0.25, false]], 0.5)];
        // 0.5 的终止音会占满整小节，必然删音；保持原样
        const result = applyCadence(plan, options, undefined, 0.5);
        expect(result).toBe(plan);
        expect(total(result[0])).toBeCloseTo(0.5, 9);
    });

    it('末音已够长但后面有休止时，等长挪到小节末尾避开和弦段', () => {
        const options = makeOptions({
            numMeasures: 1,
            timeSignature: '4/4',
            chordChart: [{ measure: 0, start: 0.5, chord: 5 }],
        });
        const harmony = buildHarmonyPlan(options);
        const plan = [
            measure(0, [[0.25, false], [0.5, false], [0.25, true]]),
        ];
        // 原末音 0.25-0.75 跨过 0.5 的换和弦；等长后移到 0.5-1.0
        const result = applyCadence(plan, options, harmony, 0.5);
        expect(shape(result[0])).toEqual([
            [0.25, false], [0.25, true], [0.5, false],
        ]);
        expect(result[0].slots[2].role).toBe('strong');
    });

    it('下限低于末音现有长度时，跨和弦的等长后移仍然生效', () => {
        const options = makeOptions({
            numMeasures: 1,
            timeSignature: '4/4',
            chordChart: [{ measure: 0, start: 0.5, chord: 5 }],
        });
        const harmony = buildHarmonyPlan(options);
        const plan = [
            measure(0, [[0.25, false], [0.5, false], [0.25, true]]),
        ];
        // 下限 0.25 小于末音的 0.5；后移不应被下限卡住
        const result = applyCadence(plan, options, harmony, 0.25);
        expect(shape(result[0])).toEqual([
            [0.25, false], [0.25, true], [0.5, false],
        ]);
    });

    it('没有换和弦时，不因尾随休止把末音挪到小节末尾', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4' });
        const plan = [
            measure(0, [[0.25, false], [0.5, false], [0.25, true]]),
        ];
        // 末音已达标且无和弦边界可避，保持原样（引用也不新建）
        expect(applyCadence(plan, options, undefined, 0.5)).toBe(plan);
        expect(applyCadence(plan, options, undefined, 0.25)).toBe(plan);
    });

    it('最后一个和弦段比末音还短时不缩短末音，原样返回', () => {
        const options = makeOptions({
            numMeasures: 1,
            timeSignature: '4/4',
            chordChart: [{ measure: 0, start: 0.625, chord: 5 }],
        });
        const harmony = buildHarmonyPlan(options);
        const plan = [
            measure(0, [[0.25, false], [0.5, false], [0.25, true]]),
        ];
        // 末段只有 0.375，0.5 的末音装不下；终止式只加长，不改写既有形态
        expect(applyCadence(plan, options, harmony, 0.5)).toBe(plan);
    });

    it('终止音整体落在最后一个和弦段内', () => {
        const options = makeOptions({
            numMeasures: 1,
            timeSignature: '4/4',
            chordChart: [{ measure: 0, start: 0.5, chord: 5 }],
        });
        const harmony = buildHarmonyPlan(options);
        const plan = [
            measure(0, [[0.25, false], [0.25, false], [0.25, false], [0.25, false]]),
        ];
        // 下限 1 全音符，但最后一个和弦段只有 0.5：终止音止步于 0.5
        const result = applyCadence(plan, options, harmony, 1);
        expect(shape(result[0])).toEqual([
            [0.25, false], [0.125, false], [0.125, false], [0.5, false],
        ]);
        expect(total(result[0])).toBeCloseTo(1, 9);
        // 终止音正好从后一段和弦的起点开始
        expect(result[0].slots[3].role).toBe('strong');
    });

    it('非 4/4 拍号仍保持容量闭合', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '3/4' });
        const plan = [
            measure(0, [[0.25, false], [0.25, false], [0.25, false]], 0.75),
        ];
        const result = applyCadence(plan, options, undefined, 0.5);
        expect(shape(result[0])).toEqual([
            [0.125, false], [0.125, false], [0.5, false],
        ]);
        expect(total(result[0])).toBeCloseTo(0.75, 9);
    });

    it('不修改入参', () => {
        const options = makeOptions({ numMeasures: 1, timeSignature: '4/4' });
        const plan = [
            measure(0, [[0.25, false], [0.25, false], [0.25, false], [0.25, true]]),
        ];
        const snapshot = JSON.parse(JSON.stringify(plan));
        applyCadence(plan, options, undefined, 0.5);
        expect(plan).toEqual(snapshot);
    });
});
