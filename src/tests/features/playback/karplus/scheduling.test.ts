/**
 * scheduling 单元测试
 *
 * buildSchedule 是纯函数，验证最容易出错的调度规则：
 * 时值→秒换算、休止/延音跳过、和弦音量补偿、
 * 扫弦/琶音的弦序与间隔、空小节兜底、多小节累计。
 */

import { describe, it, expect } from 'vitest';
import { STANDARD_TUNING, type Measure, type Note, type NoteDuration } from '../../../../core/types/index.ts';
import { KARPLUS_ARTICULATION } from '../../../../core/config.ts';
import { semitonesToRate } from '../../../../core/utils/frequency.ts';
import { resolveNoteFrequency } from '../../../../core/utils/noteFrequency.ts';
import {
    buildSchedule,
    computeForceRepluck,
    computeTechniqueChainInfo,
    computeTechniqueRing,
    naturalSoundEndMs,
} from '../../../../features/playback/karplus/scheduling.ts';

const BPM = 120; // 一拍 = 0.5s

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[], num = 4, den = 4): Measure {
    return { index: 0, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

describe('buildSchedule', () => {
    it('空谱:无事件,总时长=起始延迟', () => {
        const s = buildSchedule([], BPM);
        expect(s.events).toEqual([]);
        expect(s.totalDurationMs).toBe(100);
    });

    it('单四分音符 @120:时值0.5s,小节不足4拍补齐为4拍', () => {
        const s = buildSchedule([measure([note({ duration: 0.25 })])], BPM);
        expect(s.events).toHaveLength(1);
        expect(s.events[0].delayMs).toBeCloseTo(100, 5);
        expect(s.events[0].duration).toBeCloseTo(0.5, 5);
        // 历史行为：小节内容不足 4 拍时补齐到 4 拍 → 100 + 2000
        expect(s.totalDurationMs).toBeCloseTo(100 + 2000, 0);
    });

    it('时值映射:全音=2s、二分=1s、八分=0.25s，且偏移按时值累计', () => {
        const m = measure([note({ duration: 1 }), note({ duration: 0.5 }), note({ duration: 0.125 })]);
        const s = buildSchedule([m], BPM);
        expect(s.events[0].duration).toBeCloseTo(2, 5);
        expect(s.events[1].duration).toBeCloseTo(1, 5);
        expect(s.events[2].duration).toBeCloseTo(0.25, 5);
        expect(s.events[1].delayMs).toBeCloseTo(100 + 2000, 0);
        expect(s.events[2].delayMs).toBeCloseTo(100 + 2000 + 1000, 0);
    });

    it('清单外时值 1/3（三连音）按比例换算为 4/3 拍，不回落到 1 拍', () => {
        // 1/4 小节容量 = 1 拍；1/3 全音符 = 4/3 拍，会越过容量且不补齐，
        // 若被当成 1 拍则总时长恰好等于容量，两者可区分。
        const third = (1 / 3) as NoteDuration;
        const s = buildSchedule([measure([note({ duration: third })], 1, 4)], BPM);
        expect(s.events).toHaveLength(1);
        // 120 BPM：一拍 0.5s，4/3 拍 = 0.6667s（不是 0.5s）
        expect(s.events[0].duration).toBeCloseTo((4 / 3) * 0.5, 6);
        expect(s.events[0].duration).not.toBeCloseTo(0.5, 6);
        expect(s.totalDurationMs).toBeCloseTo(100 + (4 / 3) * 500, 1);
        expect(s.totalDurationMs).not.toBeCloseTo(100 + 500, 1);
    });

    it('休止符不产生事件但占用时值', () => {
        const m = measure([note({ duration: 0.25, isRest: true }), note({ duration: 0.25 })]);
        const s = buildSchedule([m], BPM);
        expect(s.events).toHaveLength(1);
        expect(s.events[0].delayMs).toBeCloseTo(100 + 500, 0);
    });

    it('tieToNext 且无技法的音符跳过发声但占用时值', () => {
        const m = measure([note({ duration: 0.25 }), note({ duration: 0.25, tieToNext: true })]);
        const s = buildSchedule([m], BPM);
        expect(s.events).toHaveLength(1);
        // 小节合计 1 拍（<4拍），补齐到 4 拍
        expect(s.totalDurationMs).toBeCloseTo(100 + 2000, 0);
    });

    it('和弦音量补偿:单音0.5、双音0.4、三音0.33', () => {
        // 未标力度的音符直接按基准音量验证补偿系数，不再需要躲避拍位重音
        const rest = note({ duration: 0.25, isRest: true });
        const single = buildSchedule([measure([rest, note({ duration: 0.25 })])], BPM);
        expect(single.events[0].volume).toBeCloseTo(0.5, 5);

        const duo = buildSchedule([measure([
            rest,
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
        ])], BPM);
        expect(duo.events[0].volume).toBeCloseTo(0.4, 5);

        const triad = buildSchedule([measure([
            rest,
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
            note({ duration: 0.25, chordGroup: 1, string: 3 }),
        ])], BPM);
        expect(triad.events[0].volume).toBeCloseTo(0.33, 2);
    });

    it('扫弦 down:从低音弦(6)到高音弦(1)，每弦间隔12ms', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1, string: 1, strum: 'down' }),
            note({ duration: 0.25, chordGroup: 1, string: 3, strum: 'down' }),
            note({ duration: 0.25, chordGroup: 1, string: 6, strum: 'down' }),
        ]);
        const s = buildSchedule([m], BPM);
        expect(s.events.map(e => e.note.string)).toEqual([6, 3, 1]);
        expect(s.events[1].delayMs - s.events[0].delayMs).toBe(12);
        expect(s.events[2].delayMs - s.events[1].delayMs).toBe(12);
    });

    it('扫弦 up:从高音弦(1)到低音弦(6)', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1, string: 6, strum: 'up' }),
            note({ duration: 0.25, chordGroup: 1, string: 1, strum: 'up' }),
        ]);
        const s = buildSchedule([m], BPM);
        expect(s.events.map(e => e.note.string)).toEqual([1, 6]);
    });

    it('琶音 up:从低到高，每弦间隔40ms', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1, string: 6, arpeggio: 'up' }),
            note({ duration: 0.25, chordGroup: 1, string: 1, arpeggio: 'up' }),
        ]);
        const s = buildSchedule([m], BPM);
        expect(s.events.map(e => e.note.string)).toEqual([6, 1]);
        expect(s.events[1].delayMs - s.events[0].delayMs).toBe(40);
    });

    it('琶音 down:从高到低', () => {
        const m = measure([
            note({ duration: 0.25, chordGroup: 1, string: 6, arpeggio: 'down' }),
            note({ duration: 0.25, chordGroup: 1, string: 1, arpeggio: 'down' }),
        ]);
        const s = buildSchedule([m], BPM);
        expect(s.events.map(e => e.note.string)).toEqual([1, 6]);
    });

    it('空小节按 4/4 兜底为 4 拍', () => {
        const s = buildSchedule([measure([])], BPM);
        expect(s.events).toHaveLength(0);
        expect(s.totalDurationMs).toBeCloseTo(100 + 2000, 0);
    });

    it('3/4 小节填两个四分音符 → 补齐到 3 拍，而不是 4 拍', () => {
        const s = buildSchedule([
            measure([note({ duration: 0.25 }), note({ duration: 0.25 })], 3, 4),
            measure([note({ duration: 0.25 })], 3, 4),
        ], BPM);
        // 两个事件都在第一小节；3 拍 = 1.5s，下一小节从 100 + 1500 开始
        expect(s.events[2].delayMs).toBeCloseTo(100 + 1500, 0);
        // 两个 3/4 小节合计 3s
        expect(s.totalDurationMs).toBeCloseTo(100 + 3000, 0);
    });

    it('6/8 小节按自身容量补齐（3 个四分音符）', () => {
        const s = buildSchedule([measure([], 6, 8)], BPM);
        expect(s.totalDurationMs).toBeCloseTo(100 + 1500, 0);
    });

    it('非法/零容量拍号回退 4 拍，不产生 NaN/Infinity 总时长', () => {
        for (const [num, den] of [[0, 0], [4, 0]]) {
            const s = buildSchedule([measure([], num, den)], BPM);
            expect(s.totalDurationMs).toBeCloseTo(100 + 2000, 0);
        }
    });

    it('多小节:各小节不足 4 拍时分别补齐', () => {
        const s = buildSchedule([
            measure([note({ duration: 0.25 })]),
            measure([note({ duration: 0.5 })]),
        ], BPM);
        expect(s.events[0].delayMs).toBeCloseTo(100, 0);
        // 小节1（四分）补齐到 4 拍 → 小节2 从 2100ms 开始
        expect(s.events[1].delayMs).toBeCloseTo(100 + 2000, 0);
        // 小节2（二分）再补齐到 4 拍
        expect(s.totalDurationMs).toBeCloseTo(100 + 2000 + 2000, 0);
    });
});

describe('computeTechniqueRing', () => {
    it('8 分源音 + 同弦击弦 2 分：源音保持到目标结束', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1 }),
            note({ duration: 0.5, string: 1, technique: 'hammerOn' }),
        ])], BPM);
        const ring = computeTechniqueRing(s.events, s.silenceSpansMs);
        // 目标 0.25s 处开始、时值 1s → 源音额外撑到 1.25s
        expect(ring[0]).toBeCloseTo(1.25, 5);
        // 没有后续技法目标：无需额外延长
        expect(ring[1]).toBe(0);
    });

    it('连续技法链延伸到最后一个目标音', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1 }),
            note({ duration: 0.25, string: 1, technique: 'hammerOn' }),
            note({ duration: 0.5, string: 1, technique: 'pullOff' }),
        ])], BPM);
        const ring = computeTechniqueRing(s.events, s.silenceSpansMs);
        // A: 0.25 + B 0.5 → 0.75；再到 C 0.75 + 1 → 1.75
        expect(ring[0]).toBeCloseTo(1.75, 5);
        // B: C 从 0.5 处开始、时值 1 → 1.5
        expect(ring[1]).toBeCloseTo(1.5, 5);
        expect(ring[2]).toBe(0);
    });

    it('同弦下一个音重新拨弦时不延伸', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1 }),
            note({ duration: 0.5, string: 1 }),
        ])], BPM);
        const ring = computeTechniqueRing(s.events, s.silenceSpansMs);
        expect(ring[0]).toBe(0);
        expect(ring[1]).toBe(0);
    });

    it('其他弦上的技法不延长本弦源音', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1 }),
            note({ duration: 0.5, string: 2, technique: 'hammerOn' }),
        ])], BPM);
        const ring = computeTechniqueRing(s.events, s.silenceSpansMs);
        expect(ring[0]).toBe(0);
    });

    it('小节填满时跨小节按绝对时间延伸', () => {
        const fillers = Array.from({ length: 7 }, () =>
            note({ duration: 0.125, string: 2 }));
        const s = buildSchedule([
            measure([note({ duration: 0.125, string: 1 }), ...fillers]),
            measure([note({ duration: 0.5, string: 1, technique: 'hammerOn' })]),
        ], BPM);
        const ring = computeTechniqueRing(s.events, s.silenceSpansMs);
        // 小节 1 填满 4 拍：目标在 2.0s 处开始，时值 1s
        expect(ring[0]).toBeCloseTo(2 + 1, 5);
        expect(ring[1]).toBe(0);
    });

    it('小节内容不足时，补齐的空白同样打断连接', () => {
        const s = buildSchedule([
            measure([note({ duration: 0.125, string: 1 })]),
            measure([note({ duration: 0.5, string: 1, technique: 'hammerOn' })]),
        ], BPM);
        const ring = computeTechniqueRing(s.events, s.silenceSpansMs);
        // 小节 1 补齐到 4 拍，目标在 2.0s 才开始：缓冲区早已衰减
        expect(ring[0]).toBe(0);
    });

    it('staccato 源音的缩短不被延音覆盖', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, staccato: true }),
            note({ duration: 0.5, string: 1, technique: 'hammerOn' }),
        ])], BPM);
        expect(computeTechniqueRing(s.events, s.silenceSpansMs)[0]).toBe(0);
    });

    it('events 乱序时仍按时间计算', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1 }),
            note({ duration: 0.5, string: 1, technique: 'hammerOn' }),
        ])], BPM);
        const reversed = [s.events[1], s.events[0]];
        const ring = computeTechniqueRing(reversed, []);
        expect(ring[1]).toBeCloseTo(1.25, 5);
        expect(ring[0]).toBe(0);
    });

    it('目标音的 letRing 计入延伸时长', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1 }),
            note({ duration: 0.5, string: 1, technique: 'hammerOn', letRing: true }),
        ])], BPM);
        const ring = computeTechniqueRing(s.events, s.silenceSpansMs);
        // 0.25 + (1 + 0.8)
        expect(ring[0]).toBeCloseTo(0.25 + 1.8, 5);
    });

    it('休止会打断连接，不把源音拉过静默', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1 }),
            note({ duration: 0.25, string: 1, isRest: true }),
            note({ duration: 0.125, string: 1, technique: 'hammerOn' }),
        ])], BPM);
        const ring = computeTechniqueRing(s.events, s.silenceSpansMs);
        expect(ring[0]).toBe(0);
    });

    it('空小节同样打断连接', () => {
        const s = buildSchedule([
            measure([note({ duration: 0.125, string: 1 })]),
            measure([]),
            measure([note({ duration: 0.5, string: 1, technique: 'hammerOn' })]),
        ], BPM);
        const ring = computeTechniqueRing(s.events, s.silenceSpansMs);
        expect(ring[0]).toBe(0);
    });

    it('palmMute 源音的衰减包络固定，不作为连接基础', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, palmMute: true }),
            note({ duration: 0.5, string: 1, technique: 'hammerOn' }),
        ])], BPM);
        expect(computeTechniqueRing(s.events, s.silenceSpansMs)[0]).toBe(0);
    });

    it('死音/泛音目标音必须重新拨弦，不延长源音', () => {
        for (const target of [
            note({ duration: 0.5, string: 1, technique: 'hammerOn', deadNote: true }),
            note({ duration: 0.5, string: 1, technique: 'hammerOn', harmonic: 'natural' }),
        ]) {
            const s = buildSchedule([measure([
                note({ duration: 0.125, string: 1 }),
                target,
            ])], BPM);
            expect(computeTechniqueRing(s.events, s.silenceSpansMs)[0]).toBe(0);
        }
    });
});

describe('computeTechniqueChainInfo', () => {
    const frequencyOf = (n: Note) => resolveNoteFrequency(STANDARD_TUNING, n);

    it('无技法链时倍率全为 1 且 ring 无延伸', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, fret: 5 }),
            note({ duration: 0.25, string: 2, fret: 3 }),
            note({ duration: 0.25, string: 1, fret: 7 }),
        ])], BPM);
        const info = computeTechniqueChainInfo(s.events, s.silenceSpansMs, frequencyOf);
        expect(info.rateScales).toEqual([1, 1, 1]);
        // 同弦下一个音重新拨弦，ring 不应延伸
        expect(info.ring).toEqual([0, 0, 0]);
    });

    it('同弦升品击弦：源音倍率 = 目标频率 / 源音频率', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, fret: 5 }),
            note({ duration: 0.25, string: 1, fret: 7, technique: 'hammerOn' }),
        ])], BPM);
        const info = computeTechniqueChainInfo(s.events, s.silenceSpansMs, frequencyOf);
        // 同弦相差 2 品 = 2 个半音（频率表是等律近似值，尾数有几位误差）
        expect(info.rateScales[0]).toBeCloseTo(semitonesToRate(2), 4);
        expect(info.rateScales[1]).toBe(1);
    });

    it('连续技法链取相对源音的最高目标倍率', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, fret: 5 }),
            note({ duration: 0.125, string: 1, fret: 7, technique: 'hammerOn' }),
            note({ duration: 0.25, string: 1, fret: 12, technique: 'hammerOn' }),
        ])], BPM);
        const info = computeTechniqueChainInfo(s.events, s.silenceSpansMs, frequencyOf);
        // 源音 5 品：最高目标是 12 品（7 个半音）
        expect(info.rateScales[0]).toBeCloseTo(semitonesToRate(7), 4);
        // 第二个音作为链中新源音，只到 12 品（5 个半音）
        expect(info.rateScales[1]).toBeCloseTo(semitonesToRate(5), 4);
        expect(info.rateScales[2]).toBe(1);
    });

    it('勾弦到低品位不缩短缓冲，倍率保持 1', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, fret: 12 }),
            note({ duration: 0.25, string: 1, fret: 5, technique: 'pullOff' }),
        ])], BPM);
        const info = computeTechniqueChainInfo(s.events, s.silenceSpansMs, frequencyOf);
        expect(info.rateScales[0]).toBe(1);
    });

    it('其他弦上的技法不抬高本弦倍率', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, fret: 5 }),
            note({ duration: 0.25, string: 2, fret: 7, technique: 'hammerOn' }),
        ])], BPM);
        const info = computeTechniqueChainInfo(s.events, s.silenceSpansMs, frequencyOf);
        expect(info.rateScales[0]).toBe(1);
    });

    it('同弦重新拨弦、静默、不可连接的源音都断开倍率链', () => {
        const cases: Note[][] = [
            // 同弦下一个音重新拨弦
            [
                note({ duration: 0.125, string: 1, fret: 5 }),
                note({ duration: 0.125, string: 1, fret: 7 }),
                note({ duration: 0.25, string: 1, fret: 9, technique: 'hammerOn' }),
            ],
            // 休止
            [
                note({ duration: 0.125, string: 1, fret: 5 }),
                note({ duration: 0.125, string: 1, isRest: true }),
                note({ duration: 0.25, string: 1, fret: 7, technique: 'hammerOn' }),
            ],
            // 断音 / 手掌闷音源音
            [
                note({ duration: 0.125, string: 1, fret: 5, staccato: true }),
                note({ duration: 0.25, string: 1, fret: 7, technique: 'hammerOn' }),
            ],
            [
                note({ duration: 0.125, string: 1, fret: 5, palmMute: true }),
                note({ duration: 0.25, string: 1, fret: 7, technique: 'hammerOn' }),
            ],
        ];
        for (const notes of cases) {
            const s = buildSchedule([measure(notes)], BPM);
            const info = computeTechniqueChainInfo(s.events, s.silenceSpansMs, frequencyOf);
            expect(info.rateScales[0]).toBe(1);
        }
    });

    it('events 乱序时仍按时间推导倍率', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, fret: 5 }),
            note({ duration: 0.25, string: 1, fret: 7, technique: 'hammerOn' }),
        ])], BPM);
        const reversed = [s.events[1], s.events[0]];
        const info = computeTechniqueChainInfo(reversed, [], frequencyOf);
        expect(info.rateScales[1]).toBeCloseTo(semitonesToRate(2), 4);
        expect(info.rateScales[0]).toBe(1);
    });

    it('不可发声的事件与播放层一致：跳过而不是断链', () => {
        // 7.5 品解析不出音名 → 频率 0，播放层会跳过它（不更新弦上记录）
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, fret: 5 }),
            note({ duration: 0.125, string: 1, fret: 7.5 }),
            note({ duration: 0.25, string: 1, fret: 12, technique: 'hammerOn' }),
        ])], BPM);
        const info = computeTechniqueChainInfo(s.events, s.silenceSpansMs, frequencyOf);
        // 源音到目标音的倍率链不应被跳过的事件打断
        expect(info.rateScales[0]).toBeCloseTo(semitonesToRate(7), 4);
        expect(info.rateScales[1]).toBe(1);
    });

    it('源音频率不可解时倍率保持 1', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1, fret: 7.5 }),
            note({ duration: 0.25, string: 1, fret: 12, technique: 'hammerOn' }),
        ])], BPM);
        const info = computeTechniqueChainInfo(s.events, s.silenceSpansMs, frequencyOf);
        expect(info.rateScales[0]).toBe(1);
    });

    it('泛音源音按实际泛音频率换算（不能用品位差）', () => {
        const s = buildSchedule([measure([
            // 自然泛音 7 品 = 空弦 + 19 半音 ≈ 988Hz
            note({ duration: 0.125, string: 1, fret: 7, harmonic: 'natural' }),
            // 目标 24 品 = 空弦 + 24 半音 ≈ 1319Hz
            note({ duration: 0.25, string: 1, fret: 24, technique: 'hammerOn' }),
        ])], BPM);
        const info = computeTechniqueChainInfo(s.events, s.silenceSpansMs, frequencyOf);
        // 实际相差 5 个半音；按品位差 7→24 误算会得到 17 个半音
        expect(info.rateScales[0]).toBeCloseTo(semitonesToRate(5), 4);
    });
});

describe('computeForceRepluck', () => {
    it('短休止后的技法目标强制重拨（此时源音缓冲区可能还没过期）', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1 }),
            note({ duration: 0.0625, string: 1, isRest: true }),
            note({ duration: 0.0625, string: 1, technique: 'hammerOn' }),
        ])], BPM);
        const forced = computeForceRepluck(s.events, s.silenceSpansMs);
        // 休止不产生事件，目标音是第 2 个事件（索引 1）
        expect(forced[1]).toBe(true);
    });

    it('无静默的连续技法链不强制重拨', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125, string: 1 }),
            note({ duration: 0.25, string: 1, technique: 'hammerOn' }),
            note({ duration: 0.125, string: 1, technique: 'pullOff' }),
        ])], BPM);
        expect(computeForceRepluck(s.events, s.silenceSpansMs)).toEqual([false, false, false]);
    });

    it('跨小节补齐的静默同样强制重拨', () => {
        const s = buildSchedule([
            measure([note({ duration: 0.125, string: 1 })]),
            measure([note({ duration: 0.5, string: 1, technique: 'hammerOn' })]),
        ], BPM);
        const forced = computeForceRepluck(s.events, s.silenceSpansMs);
        expect(forced[1]).toBe(true);
    });

    it('events 乱序时仍按时间判断', () => {
        const s = buildSchedule([
            measure([note({ duration: 0.125, string: 1 })]),
            measure([note({ duration: 0.5, string: 1, technique: 'hammerOn' })]),
        ], BPM);
        // 反序后目标音是索引 0，源音是索引 1
        const forced = computeForceRepluck(
            [s.events[1], s.events[0]],
            s.silenceSpansMs,
        );
        expect(forced[0]).toBe(true);
        expect(forced[1]).toBe(false);
    });
});

describe('力度 dynamics → 音量', () => {
    it('accent 抬音量、soft 压音量，普通音保持基准', () => {
        // plain 未标力度，以基准音量为参照验证 accent / soft 的相对关系
        const s = buildSchedule([measure([
            note({ duration: 0.25, dynamics: 'accent' }),
            note({ duration: 0.25, dynamics: 'soft' }),
            note({ duration: 0.25 }),
        ], 3, 4)], BPM);
        const [accent, soft, plain] = s.events;
        expect(accent.volume).toBeGreaterThan(plain.volume);
        expect(soft.volume).toBeLessThan(plain.volume);
    });

    it('有 dynamics 的音符仍按和弦人数先做音量补偿（两个系数相乘）', () => {
        const single = buildSchedule([measure([note({ duration: 0.25, dynamics: 'accent' })])], BPM);
        const chord = buildSchedule([measure([
            note({ duration: 0.25, dynamics: 'accent', chordGroup: 1 }),
            note({ duration: 0.25, dynamics: 'accent', chordGroup: 1, string: 2 }),
        ])], BPM);
        // 双音的和弦补偿更低，所以同是 accent，和弦里的音量应小于单音
        expect(chord.events[0].volume).toBeLessThan(single.events[0].volume);
    });

    it('accent 与 soft 的差距足够大（太小就听不出重音）', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25, dynamics: 'accent' }),
            note({ duration: 0.25, dynamics: 'soft' }),
        ])], BPM);
        expect(s.events[0].volume / s.events[1].volume).toBeGreaterThan(1.8);
    });
});

describe('力度只按谱面标识', () => {
    it('未标力度不派生重音：4/4 四拍全部保持基准音量', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
        ])], BPM);
        expect(s.events.map(e => e.dynamics))
            .toEqual([undefined, undefined, undefined, undefined]);
        for (const event of s.events) {
            expect(event.volume).toBeCloseTo(0.5, 5);
        }
    });

    it('3/4、6/8 同样不按拍位派生', () => {
        const threeFour = buildSchedule([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
        ], 3, 4)], BPM);
        expect(threeFour.events.every(e => e.dynamics === undefined)).toBe(true);

        const sixEight = buildSchedule([measure([
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
        ], 6, 8)], BPM);
        expect(sixEight.events.every(e => e.dynamics === undefined)).toBe(true);
    });

    it('显式 dynamics 逐音生效：soft 压音量、accent 抬音量', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25, dynamics: 'soft' }),
            note({ duration: 0.25, dynamics: 'accent' }),
        ])], BPM);
        expect(s.events[0].dynamics).toBe('soft');
        expect(s.events[0].volume).toBeCloseTo(0.5 * 0.65, 5);
        expect(s.events[1].dynamics).toBe('accent');
        expect(s.events[1].volume).toBeCloseTo(0.5 * 1.35, 5);
    });

    it('休止符不改变后续音符的力度', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25, isRest: true }),
            note({ duration: 0.25 }),
        ])], BPM);
        expect(s.events).toHaveLength(1);
        expect(s.events[0].dynamics).toBeUndefined();
        expect(s.events[0].volume).toBeCloseTo(0.5, 5);
    });

    it('和弦：未标力度的成员保持基准，显式仍逐音生效', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2, dynamics: 'soft' }),
        ])], BPM);
        expect(s.events[0].dynamics).toBeUndefined();
        expect(s.events[0].volume).toBeCloseTo(0.4, 5);
        expect(s.events[1].dynamics).toBe('soft');
        expect(s.events[1].volume).toBeCloseTo(0.4 * 0.65, 5);
    });
});

describe('naturalSoundEndMs 自然收尾点', () => {
    /** 4 个四分音符填满 4/4；末音 1600ms 起，0.5s 时值 + KS 尾音 */
    function fourQuarters(): ReturnType<typeof buildSchedule> {
        return buildSchedule([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
        ])], BPM);
    }

    it('末音实际发声终点晚于谱面总时长时，取末音终点', () => {
        const s = fourQuarters();
        expect(naturalSoundEndMs(s.events, s.events.map(() => 0), s.totalDurationMs))
            .toBeCloseTo(
                1600 + (0.5 + KARPLUS_ARTICULATION.noteTailSec) * 1000,
                5,
            );
    });

    it('尾音没有超出谱面总时长时，至少播放到 totalDurationMs', () => {
        const s = buildSchedule([measure([note({ duration: 0.25 })])], BPM);
        expect(naturalSoundEndMs(s.events, s.events.map(() => 0), s.totalDurationMs))
            .toBeCloseTo(s.totalDurationMs, 5);
    });

    it('计入同弦技法链的 ring 延音', () => {
        const s = fourQuarters();
        // 末音作为源音要撑到 1.2s 后的技法目标
        const ring = s.events.map((_, i) => (i === s.events.length - 1 ? 1.2 : 0));
        expect(naturalSoundEndMs(s.events, ring, s.totalDurationMs))
            .toBeCloseTo(1600 + 1200 + KARPLUS_ARTICULATION.noteTailSec * 1000, 5);
    });

    it('计入扫弦/琶音偏移：最后一个事件可能晚于拍位起点', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25, isRest: true }),
            note({ duration: 0.25, isRest: true }),
            note({ duration: 0.25, isRest: true }),
            note({ duration: 0.25, chordGroup: 1, string: 6, arpeggio: 'up' }),
            note({ duration: 0.25, chordGroup: 1, string: 1, arpeggio: 'up' }),
        ])], BPM);
        // 琶音最后一个事件在拍位起点后 40ms
        expect(naturalSoundEndMs(s.events, s.events.map(() => 0), s.totalDurationMs))
            .toBeCloseTo(
                1600 + 40 + (0.5 + KARPLUS_ARTICULATION.noteTailSec) * 1000,
                5,
            );
    });

    it('计入 letRing 的额外延长', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25, letRing: true }),
        ])], BPM);
        expect(naturalSoundEndMs(s.events, s.events.map(() => 0), s.totalDurationMs))
            .toBeCloseTo(
                1600 + (0.5 + KARPLUS_ARTICULATION.letRingExtraSec
                    + KARPLUS_ARTICULATION.noteTailSec) * 1000,
                5,
            );
    });

    it('空谱返回起始延迟，不产生多余尾音', () => {
        const s = buildSchedule([], BPM);
        expect(naturalSoundEndMs(s.events, [], s.totalDurationMs)).toBe(s.totalDurationMs);
    });

    it('极短末音也留出 minSoundSec，不会提前收尾', () => {
        // BPM 200：一拍 0.3s，整小节 1.2s。前五个时值合计 0.96875，
        // 最后的 32 分音符正好落在小节末端，0.0375s 不足 minSoundSec 0.05s。
        const s = buildSchedule([measure([
            note({ duration: 0.5 }),
            note({ duration: 0.25 }),
            note({ duration: 0.125 }),
            note({ duration: 0.0625 }),
            note({ duration: 0.03125 }),
            note({ duration: 0.03125 }),
        ])], 200);
        // 末音 1262.5ms 起；实时发声 = minSoundSec + KS 尾音
        expect(naturalSoundEndMs(s.events, s.events.map(() => 0), s.totalDurationMs))
            .toBeCloseTo(
                1262.5 + (KARPLUS_ARTICULATION.minSoundSec
                    + KARPLUS_ARTICULATION.noteTailSec) * 1000,
                5,
            );
    });

    it('ringSecs 比事件短或含非法值时按 0 处理', () => {
        const s = fourQuarters();
        const baseline = naturalSoundEndMs(
            s.events, s.events.map(() => 0), s.totalDurationMs,
        );
        expect(naturalSoundEndMs(s.events, [], s.totalDurationMs)).toBeCloseTo(baseline, 5);
        expect(naturalSoundEndMs(
            s.events, s.events.map(() => NaN), s.totalDurationMs,
        )).toBeCloseTo(baseline, 5);
    });

    it('非法总时长不产生 NaN/Infinity', () => {
        const s = fourQuarters();
        const rings = s.events.map(() => 0);
        expect(naturalSoundEndMs(s.events, rings, NaN)).toBeCloseTo(1600 + 700, 5);
        expect(Number.isFinite(naturalSoundEndMs(s.events, rings, Infinity))).toBe(true);
    });

    it('解析不出频率的事件不发声，不计入收尾', () => {
        const s = fourQuarters();
        const rings = s.events.map(() => 0);
        // 不传频率：末音按完整时值计入 → 2300ms
        expect(naturalSoundEndMs(s.events, rings, s.totalDurationMs)).toBeCloseTo(2300, 5);
        // 全部不可发声：只剩谱面总时长，不能被末音拖到 2300ms
        expect(naturalSoundEndMs(s.events, rings, s.totalDurationMs, () => 0))
            .toBeCloseTo(s.totalDurationMs, 5);
    });
});
