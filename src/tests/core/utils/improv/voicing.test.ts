/**
 * voicing — 多声部把位候选与和弦加厚测试。
 *
 * 覆盖两件事：
 * - `voicingCandidatesForMidis`：单声部顺序与旧映射一致、多声部的弦号/跨度约束、
 *   非法输入拒绝与结果确定性；
 * - `addVoicings`：概率为 0 时不消耗随机流、强拍/句尾/长音加厚、
 *   弱拍短音保持原样、同 seed 复现且不修改入参、不可行时降级。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import { STANDARD_TUNING } from '../../../../core/types/index.ts';
import type {
    SkeletonSlot,
    StyleProfile,
} from '../../../../core/types/improv.ts';
import { buildHarmonyPlan } from '../../../../core/utils/improv/harmony.ts';
import { midiToFretPositions, pitchClassOf } from '../../../../core/utils/improv/pitch.ts';
import { createRng } from '../../../../core/utils/improv/random.ts';
import { addVoicings, voicingCandidatesForMidis } from '../../../../core/utils/improv/voicing.ts';
import { makeOptions } from './testOptions.ts';

const PLAYABILITY = LOCAL_IMPROV_CONFIG.playability;

function slot(
    midi: number,
    overrides: Partial<SkeletonSlot> = {},
): SkeletonSlot {
    return {
        measureIndex: 0,
        slotIndex: 0,
        duration: 0.25,
        isRest: false,
        midis: [midi],
        role: 'weak',
        ...overrides,
    };
}

/** Folk 为底，默认和弦概率拉满，便于断言加厚分支 */
function chordStyle(overrides: Partial<StyleProfile> = {}): StyleProfile {
    return {
        ...LOCAL_IMPROV_CONFIG.styleProfiles.Folk,
        chordProbability: 1,
        ...overrides,
    };
}

/** 固定值 rng：0 让概率分支必然命中 */

function constantRng(value: number): () => number {
    return () => value;
}

describe('voicingCandidatesForMidis', () => {
    it('单声部候选顺序与 midiToFretPositions 完全一致', () => {
        const expected = midiToFretPositions(STANDARD_TUNING, 64, 0, 24);
        const candidates = voicingCandidatesForMidis(
            STANDARD_TUNING, [64], 0, 24, PLAYABILITY,
        );

        expect(expected.length).toBeGreaterThan(1);
        expect(candidates).toEqual(expected.map(position => [position]));
    });

    it('多声部：弦号唯一、随 MIDI 升序严格递减、跨度满足上限', () => {
        const midis = [60, 64];
        const candidates = voicingCandidatesForMidis(
            STANDARD_TUNING, midis, 0, 24, PLAYABILITY,
        );

        expect(candidates.length).toBeGreaterThan(0);
        for (const candidate of candidates) {
            expect(candidate).toHaveLength(midis.length);
            candidate.forEach((position, index) => {
                expect(position.midi).toBe(midis[index]);
                expect(position.string).toBeGreaterThanOrEqual(1);
                expect(position.string).toBeLessThanOrEqual(6);
            });

            const strings = candidate.map(position => position.string);
            const frets = candidate.map(position => position.fret);
            expect(new Set(strings).size).toBe(strings.length);
            for (let i = 1; i < strings.length; i++) {
                expect(strings[i]).toBeLessThan(strings[i - 1]);
            }
            expect(Math.max(...frets) - Math.min(...frets))
                .toBeLessThanOrEqual(PLAYABILITY.maxChordSpanFrets);
            expect(Math.max(...strings) - Math.min(...strings))
                .toBeLessThanOrEqual(PLAYABILITY.maxChordStringSpan);
        }
    });

    it('非严格升序 / 超过最大声部数 / 无法同时按出 → 空数组', () => {
        const call = (midis: number[]) => voicingCandidatesForMidis(
            STANDARD_TUNING, midis, 0, 24, PLAYABILITY,
        );

        expect(call([64, 60])).toEqual([]);
        expect(call([60, 60])).toEqual([]);
        expect(call([48, 52, 55, 60])).toEqual([]);
        expect(call([55, 84])).toEqual([]);
    });

    it('空音高与非整数音高 → 空数组', () => {
        const call = (midis: number[]) => voicingCandidatesForMidis(
            STANDARD_TUNING, midis, 0, 24, PLAYABILITY,
        );

        expect(call([])).toEqual([]);
        expect(call([60.5])).toEqual([]);
    });

    it('同一输入重复调用结果完全一致（含顺序）', () => {
        const build = () => voicingCandidatesForMidis(
            STANDARD_TUNING, [60, 64, 67], 0, 24, PLAYABILITY,
        );

        const first = build();
        expect(first.length).toBeGreaterThan(0);
        expect(build()).toEqual(first);
    });
});

describe('addVoicings', () => {
    it('chordProbability 为 0 时逐位原样返回且不消耗随机流', () => {
        const skeleton = [
            slot(67, { role: 'strong', duration: 0.5 }),
            slot(64, { duration: 0.5 }),
            { isRest: true, duration: 0.25, measureIndex: 0, slotIndex: 2, midis: [], role: 'weak' } as SkeletonSlot,
        ];
        const throwingRng = (): number => {
            throw new Error('chordProbability 为 0 时不应消耗随机数');
        };

        const result = addVoicings(
            skeleton, [], makeOptions(), chordStyle({ chordProbability: 0 }),
            PLAYABILITY, throwingRng,
        );

        expect(result).toEqual(skeleton);
        result.forEach((item, index) => expect(item).toBe(skeleton[index]));
    });

    it('强拍/句尾/长音加厚为 2-3 声部，旋律最高且音级不重复', () => {
        const options = makeOptions({
            numMeasures: 1,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [1],
        });
        const harmony = buildHarmonyPlan(options);
        const skeleton: SkeletonSlot[] = [
            slot(67, { slotIndex: 0, role: 'strong', duration: 0.5, phraseIndex: 0 }),
            slot(67, { slotIndex: 1, role: 'weak', duration: 0.25, phraseIndex: 0 }),
            slot(67, { slotIndex: 2, role: 'weak', duration: 0.125, phraseIndex: 0 }),
        ];
        // slot 0 强拍、slot 1 长音（≥ minChordDuration）、slot 2 句尾（弱拍短音）

        const result = addVoicings(
            skeleton, harmony, options, chordStyle(), PLAYABILITY, constantRng(0),
        );

        for (const index of [0, 1, 2]) {
            const voiced = result[index];
            expect(voiced.midis.length).toBeGreaterThanOrEqual(2);
            expect(voiced.midis.length).toBeLessThanOrEqual(PLAYABILITY.maxChordVoices);
            // 旋律音仍在最后且是最高音
            expect(voiced.midis[voiced.midis.length - 1]).toBe(67);
            expect(Math.max(...voiced.midis)).toBe(67);
            // 音级不重复
            const pitchClasses = voiced.midis.map(midi => pitchClassOf(midi));
            expect(new Set(pitchClasses).size).toBe(pitchClasses.length);
            // 相邻声部间隔与总跨度满足配置
            for (let i = 1; i < voiced.midis.length; i++) {
                expect(voiced.midis[i] - voiced.midis[i - 1])
                    .toBeGreaterThanOrEqual(PLAYABILITY.minVoicingGapSemitones);
            }
            expect(Math.max(...voiced.midis) - Math.min(...voiced.midis))
                .toBeLessThanOrEqual(PLAYABILITY.maxVoicingSpanSemitones);
        }
    });

    it('不符合触发条件的弱拍短音保持原样', () => {
        const options = makeOptions({
            numMeasures: 1,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [1],
        });
        const harmony = buildHarmonyPlan(options);
        const skeleton: SkeletonSlot[] = [
            // 弱拍 + 短于 minChordDuration + 非句尾
            slot(67, { slotIndex: 0, role: 'weak', duration: 0.125, phraseIndex: 0 }),
            // 同句后面的长音，保证 slot 0 不是句尾
            slot(67, { slotIndex: 1, role: 'weak', duration: 0.5, phraseIndex: 0 }),
        ];

        const result = addVoicings(
            skeleton, harmony, options, chordStyle(), PLAYABILITY, constantRng(0),
        );

        expect(result[0]).toBe(skeleton[0]);
        expect(result[0].midis).toEqual([67]);
    });

    it('同 seed 两次结果完全一致，且不修改入参 skeleton', () => {
        const options = makeOptions({
            numMeasures: 1,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [1],
        });
        const harmony = buildHarmonyPlan(options);
        const skeleton: SkeletonSlot[] = [
            slot(67, { slotIndex: 0, role: 'strong', duration: 0.5, phraseIndex: 0 }),
            slot(64, { slotIndex: 1, role: 'weak', duration: 0.25, phraseIndex: 0 }),
        ];
        const snapshot = JSON.parse(JSON.stringify(skeleton)) as SkeletonSlot[];

        const build = () => addVoicings(
            skeleton, harmony, options, chordStyle(), PLAYABILITY, createRng(42),
        );

        const first = build();
        const second = build();

        expect(first).toEqual(second);
        expect(first[0].midis.length).toBeGreaterThan(1);
        expect(skeleton).toEqual(snapshot);
    });

    it('两个附加声部不可行时降为 1 个附加声部', () => {
        const options = makeOptions({
            numMeasures: 1,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [1],
        });
        const harmony = buildHarmonyPlan(options);
        // C 大调三和弦 0/4/7；旋律 65 的音域窗口恰好缺 4，2 声部无解、1 声部可行
        const skeleton = [
            slot(65, { role: 'strong', duration: 0.5, phraseIndex: 0 }),
        ];

        const result = addVoicings(
            skeleton, harmony, options, chordStyle(), PLAYABILITY, constantRng(0),
        );

        expect(result[0].midis).toHaveLength(2);
        expect(result[0].midis[1]).toBe(65);
        expect(result[0].midis[0]).toBe(60);
    });

    it('1 个附加声部也不可行时保持单音', () => {
        const options = makeOptions({
            numMeasures: 1,
            key: 'C',
            scaleType: 'Major (Ionian)',
            progression: [1],
        });
        const harmony = buildHarmonyPlan(options);
        // 旋律 61 的音域窗口缺 0，首选的根音也取不到
        const skeleton = [
            slot(61, { role: 'strong', duration: 0.5, phraseIndex: 0 }),
        ];

        const result = addVoicings(
            skeleton, harmony, options, chordStyle(), PLAYABILITY, constantRng(0),
        );

        expect(result[0]).toBe(skeleton[0]);
        expect(result[0].midis).toEqual([61]);
    });
});
