/**
 * 本地即兴配置的漂移测试。
 *
 * 两套配置必须共享同一组风格/密度/音阶取值，但不能共用同一个对象：
 * IMPROV_CONFIG 是 AI prompt 资产，LOCAL_IMPROV_CONFIG 是机器权重。
 */

import { describe, it, expect } from 'vitest';
import { IMPROV_CONFIG, LOCAL_IMPROV_CONFIG } from '../../core/config.ts';
import {
    LOCAL_DENSITIES,
    LOCAL_STYLES,
    SCALE_INTERVALS,
    SCALE_TYPES,
} from '../../core/types/improv.ts';
import { NOTE_DURATIONS, STANDARD_TUNING } from '../../core/types/index.ts';
import { capacityFromTimeSignature } from '../../core/utils/measureUtils.ts';

describe('LOCAL_IMPROV_CONFIG', () => {
    it('本地允许 2 小节，AI 仍保持 3 小节下限', () => {
        expect(LOCAL_IMPROV_CONFIG.numMeasures.min).toBe(2);
        expect(IMPROV_CONFIG.numMeasures.min).toBe(3);
    });

    it('默认值符合既定兜底', () => {
        expect(LOCAL_IMPROV_CONFIG.defaults).toMatchObject({
            numMeasures: 4,
            key: 'C',
            scaleType: 'Major (Ionian)',
            style: 'Folk',
            density: '中',
            timeSignature: '4/4',
            tuning: STANDARD_TUNING,
            seed: 1,
        });
    });

    it('风格取值与 AI 配置的 value 集合一致', () => {
        expect(new Set(Object.keys(LOCAL_IMPROV_CONFIG.styleProfiles)))
            .toEqual(new Set(IMPROV_CONFIG.styles.map(option => option.value)));
        expect(new Set(LOCAL_STYLES))
            .toEqual(new Set(IMPROV_CONFIG.styles.map(option => option.value)));
    });

    it('密度取值与 AI 配置的 value 集合一致', () => {
        expect(new Set(Object.keys(LOCAL_IMPROV_CONFIG.densityProfiles)))
            .toEqual(new Set(IMPROV_CONFIG.densities.map(option => option.value)));
        expect(new Set(LOCAL_DENSITIES))
            .toEqual(new Set(IMPROV_CONFIG.densities.map(option => option.value)));
    });

    it('音阶取值与 AI 配置及音程表一致', () => {
        const aiScales = new Set(IMPROV_CONFIG.scaleTypes.map(option => option.value));
        expect(new Set(SCALE_TYPES)).toEqual(aiScales);
        expect(new Set(Object.keys(SCALE_INTERVALS))).toEqual(aiScales);
    });

    it('小节数选项包含 2/4/8/12/16', () => {
        expect(LOCAL_IMPROV_CONFIG.numMeasures.options).toEqual([2, 4, 8, 12, 16]);
    });

    it('小节数默认值与 defaults.numMeasures 不漂移', () => {
        expect(LOCAL_IMPROV_CONFIG.numMeasures.default)
            .toBe(LOCAL_IMPROV_CONFIG.defaults.numMeasures);
    });

    it('所有拍号都能被容量公式解析，且容量是 0.125 的整数倍', () => {
        for (const signature of LOCAL_IMPROV_CONFIG.timeSignatures) {
            const capacity = capacityFromTimeSignature(signature);
            expect(Number.isFinite(capacity)).toBe(true);
            expect(capacity).toBeGreaterThan(0);
            expect(capacity * 8).toBeCloseTo(Math.round(capacity * 8), 9);
        }
    });

    it('所有风格/密度时值都来自 NOTE_DURATIONS，且权重为正', () => {
        const validDurations = new Set<number>(NOTE_DURATIONS);
        const profiles = [
            ...Object.values(LOCAL_IMPROV_CONFIG.styleProfiles),
            ...Object.values(LOCAL_IMPROV_CONFIG.densityProfiles),
        ];
        for (const profile of profiles) {
            for (const item of profile.durations) {
                expect(validDurations.has(item.duration)).toBe(true);
                expect(item.weight).toBeGreaterThan(0);
            }
        }
    });

    it('可演奏性范围覆盖标准调弦的 0-24 品', () => {
        expect(LOCAL_IMPROV_CONFIG.playability).toMatchObject({
            fretMin: 0,
            fretMax: 24,
            palmMuteStrings: [4, 6],
        });
    });
});

describe('capacityFromTimeSignature', () => {
    it('常见拍号容量', () => {
        expect(capacityFromTimeSignature('4/4')).toBe(1);
        expect(capacityFromTimeSignature('3/4')).toBe(0.75);
        expect(capacityFromTimeSignature('6/8')).toBe(0.75);
        expect(capacityFromTimeSignature('7/8')).toBe(0.875);
        expect(capacityFromTimeSignature('12/8')).toBe(1.5);
    });
});
