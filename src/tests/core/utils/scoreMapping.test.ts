/**
 * scoreMapping 单元测试
 *
 * scoreMapping 是 alphaTab ↔ 应用的纯映射（无 DOM），验证：
 * 弦号反转、Duration 枚举的两套口径（NoteDuration 相对值与全音符分数）、
 * 以及 beat 在小节内的拍偏移累加。
 *
 * 注：本文件不复测 detectTechnique —— 它已在
 * src/tests/features/alphaTab/scoreEditing.test.ts 覆盖。
 *
 * 已实测的 alphaTab 枚举数值：Whole=1 Half=2 Quarter=4 Eighth=8
 * Sixteenth=16 ThirtySecond=32 SixtyFourth=64。
 */

import { describe, it, expect } from 'vitest';
import { model } from '@coderline/alphatab';
import {
    alphaStringToAppString,
    alphaDurationToAppDuration,
    alphaDurationToWholeNote,
    beatOffsetInMeasure,
} from '../../../core/utils/scoreMapping.ts';

/** 手工拼一个 voice：按给定 Duration 顺序追加 beat（addBeat 会回填 beat.voice） */
function voiceWith(durations: model.Duration[]): model.Voice {
    const voice = new model.Voice();
    for (const d of durations) {
        const beat = new model.Beat();
        beat.duration = d;
        voice.addBeat(beat);
    }
    return voice;
}

describe('alphaStringToAppString', () => {
    it('六根弦全表：alphaTab 1↔6 反向映射（1=最低弦 → 应用 1=高音 E）', () => {
        const cases: Array<[number, number]> = [
            [1, 6],
            [2, 5],
            [3, 4],
            [4, 3],
            [5, 2],
            [6, 1],
        ];
        for (const [alphaString, appString] of cases) {
            expect(alphaStringToAppString(alphaString)).toBe(appString);
        }
    });

    it('边界弦号 1 与 6 互换；两两往返回到原值', () => {
        expect(alphaStringToAppString(1)).toBe(6);
        expect(alphaStringToAppString(6)).toBe(1);
        for (let s = 1; s <= 6; s++) {
            expect(alphaStringToAppString(alphaStringToAppString(s))).toBe(s);
        }
    });
});

describe('alphaDurationToAppDuration（NoteDuration 口径）', () => {
    it('Duration 枚举 → 应用相对时值（Quarter=4 → 0.25）', () => {
        expect(model.Duration.Quarter).toBe(4);

        const cases: Array<[model.Duration, number]> = [
            [model.Duration.Whole, 1],
            [model.Duration.Half, 0.5],
            [model.Duration.Quarter, 0.25],
            [model.Duration.Eighth, 0.125],
            [model.Duration.Sixteenth, 0.0625],
            [model.Duration.ThirtySecond, 0.03125],
        ];
        for (const [d, expected] of cases) {
            expect(alphaDurationToAppDuration(d)).toBe(expected);
        }
    });

    it('返回值与 NoteDuration 全集一一对应（1/0.5/0.25/0.125/0.0625/0.03125）', () => {
        const all = [
            alphaDurationToAppDuration(model.Duration.Whole),
            alphaDurationToAppDuration(model.Duration.Half),
            alphaDurationToAppDuration(model.Duration.Quarter),
            alphaDurationToAppDuration(model.Duration.Eighth),
            alphaDurationToAppDuration(model.Duration.Sixteenth),
            alphaDurationToAppDuration(model.Duration.ThirtySecond),
        ];
        expect(all).toEqual([1, 0.5, 0.25, 0.125, 0.0625, 0.03125]);
    });

    it('超出 NoteDuration 的枚举（SixtyFourth=64）仍按 1/d 返回 0.015625', () => {
        // 实现是 `1/d as NoteDuration`，类型断言不做运行时校验：
        // 返回值落在 NoteDuration 之外，调用方不可假定其一定是合法时值。
        expect(model.Duration.SixtyFourth).toBe(64);
        expect(alphaDurationToAppDuration(model.Duration.SixtyFourth)).toBe(0.015625);
    });
});

describe('alphaDurationToWholeNote（全音符分数口径）', () => {
    it('Duration 枚举 → 全音符分数（Quarter=4 → 0.25）', () => {
        const cases: Array<[model.Duration, number]> = [
            [model.Duration.Whole, 1],
            [model.Duration.Half, 0.5],
            [model.Duration.Quarter, 0.25],
            [model.Duration.Eighth, 0.125],
            [model.Duration.Sixteenth, 0.0625],
            [model.Duration.ThirtySecond, 0.03125],
        ];
        for (const [d, expected] of cases) {
            expect(alphaDurationToWholeNote(d)).toBe(expected);
        }
    });

    it('六种时值求和恰为 1 个全音符（1+1/2+1/4+1/8+1/16+1/32 = 1.96875）', () => {
        const sum =
            alphaDurationToWholeNote(model.Duration.Whole) +
            alphaDurationToWholeNote(model.Duration.Half) +
            alphaDurationToWholeNote(model.Duration.Quarter) +
            alphaDurationToWholeNote(model.Duration.Eighth) +
            alphaDurationToWholeNote(model.Duration.Sixteenth) +
            alphaDurationToWholeNote(model.Duration.ThirtySecond);
        expect(sum).toBe(1.96875);
    });
});

describe('两套口径在同一 Duration 输入下的差异', () => {
    it('数值上完全相同（两函数实现同为 1/d，差异仅在返回类型注解）', () => {
        const all = [
            model.Duration.Whole,
            model.Duration.Half,
            model.Duration.Quarter,
            model.Duration.Eighth,
            model.Duration.Sixteenth,
            model.Duration.ThirtySecond,
        ];
        for (const d of all) {
            expect(alphaDurationToAppDuration(d)).toBe(alphaDurationToWholeNote(d));
        }
    });

    it('口径语义不同：NoteDuration 是相对值全集，全音符分数可超出该全集', () => {
        // 二分音符：两者同为 0.5，但 0.5 在 NoteDuration 中是「二分音符」
        expect(alphaDurationToWholeNote(model.Duration.Half)).toBe(0.5);
        expect(alphaDurationToAppDuration(model.Duration.Half)).toBe(0.5);
        // 六十四分音符：全音符分数仍然成立（0.015625），但已不是合法 NoteDuration
        expect(alphaDurationToWholeNote(model.Duration.SixtyFourth)).toBe(0.015625);
    });
});

describe('beatOffsetInMeasure', () => {
    it('小节首个 beat → 0', () => {
        const v = voiceWith([model.Duration.Quarter, model.Duration.Quarter]);
        expect(beatOffsetInMeasure(v.beats[0])).toBe(0);
    });

    it('单个 beat 的 voice → 该 beat 偏移为 0', () => {
        const v = voiceWith([model.Duration.Whole]);
        expect(beatOffsetInMeasure(v.beats[0])).toBe(0);
    });

    it('4 个四分音符 → 0 / 0.25 / 0.5 / 0.75（末拍累计 1 个全音符）', () => {
        const v = voiceWith([
            model.Duration.Quarter,
            model.Duration.Quarter,
            model.Duration.Quarter,
            model.Duration.Quarter,
        ]);
        expect(v.beats).toHaveLength(4);
        expect(beatOffsetInMeasure(v.beats[0])).toBe(0);
        expect(beatOffsetInMeasure(v.beats[1])).toBe(0.25);
        expect(beatOffsetInMeasure(v.beats[2])).toBe(0.5);
        expect(beatOffsetInMeasure(v.beats[3])).toBe(0.75);
    });

    it('混合时值 [H,Q,E,S] → 0 / 0.5 / 0.75 / 0.875，且只累加其前的 beat', () => {
        const v = voiceWith([
            model.Duration.Half,
            model.Duration.Quarter,
            model.Duration.Eighth,
            model.Duration.Sixteenth,
        ]);
        expect(beatOffsetInMeasure(v.beats[0])).toBe(0);
        expect(beatOffsetInMeasure(v.beats[1])).toBe(0.5);
        expect(beatOffsetInMeasure(v.beats[2])).toBe(0.75);
        expect(beatOffsetInMeasure(v.beats[3])).toBe(0.875);
        // 1/2 + 1/4 + 1/8 + 1/16 = 0.9375 < 1，小节未占满
        expect(
            beatOffsetInMeasure(v.beats[3]) + alphaDurationToWholeNote(v.beats[3].duration),
        ).toBe(0.9375);
    });

    it('极端组合 [ThirtySecond×3, Whole] → 0 / 0.03125 / 0.0625 / 0.09375', () => {
        const v = voiceWith([
            model.Duration.ThirtySecond,
            model.Duration.ThirtySecond,
            model.Duration.ThirtySecond,
            model.Duration.Whole,
        ]);
        expect(beatOffsetInMeasure(v.beats[0])).toBe(0);
        expect(beatOffsetInMeasure(v.beats[1])).toBe(0.03125);
        expect(beatOffsetInMeasure(v.beats[2])).toBe(0.0625);
        expect(beatOffsetInMeasure(v.beats[3])).toBe(0.09375);
    });

    it('偏移单调递增，且每一拍偏移 = 其前各拍时值之和', () => {
        const durations = [
            model.Duration.Eighth,
            model.Duration.Half,
            model.Duration.Sixteenth,
            model.Duration.Quarter,
        ];
        const v = voiceWith(durations);
        let running = 0;
        for (let i = 0; i < v.beats.length; i++) {
            expect(beatOffsetInMeasure(v.beats[i])).toBe(running);
            running += alphaDurationToWholeNote(durations[i]);
        }
    });
});
