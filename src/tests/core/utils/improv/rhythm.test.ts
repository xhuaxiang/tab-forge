/**
 * rhythm — 容量精确闭合与角色标记测试。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type { NoteDuration } from '../../../../core/types/index.ts';
import { NOTE_DURATIONS } from '../../../../core/types/index.ts';
import { LOCAL_DENSITIES } from '../../../../core/types/improv.ts';
import { capacityFromTimeSignature } from '../../../../core/utils/measureUtils.ts';
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
