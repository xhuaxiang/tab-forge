/**
 * scheduling 单元测试
 *
 * buildSchedule 是纯函数，验证最容易出错的调度规则：
 * 时值→秒换算、休止/延音跳过、和弦音量补偿、
 * 扫弦/琶音的弦序与间隔、空小节兜底、多小节累计。
 */

import { describe, it, expect } from 'vitest';
import type { Measure, Note } from '../../../../core/types/index.ts';
import { buildSchedule } from '../../../../features/playback/karplus/scheduling.ts';

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
        // 放在第 2 拍（前面加四分休止），避开第 1 拍的拍位重音，单独验证补偿系数
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

describe('力度 dynamics → 音量', () => {
    it('accent 抬音量、soft 压音量，普通音保持基准', () => {
        // 3/4：只有第 1 拍是强拍，第 3 拍不会触发拍位重音，plain 才是真·基准
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

describe('拍位自动重音', () => {
    it('4/4 未标力度的第 1、3 拍抬音量，第 2、4 拍保持基准', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
        ])], BPM);
        expect(s.events.map(e => e.dynamics)).toEqual(['accent', undefined, 'accent', undefined]);
        expect(s.events[0].volume).toBeCloseTo(0.5 * 1.35, 5);
        expect(s.events[1].volume).toBeCloseTo(0.5, 5);
        expect(s.events[2].volume).toBeCloseTo(0.5 * 1.35, 5);
        expect(s.events[3].volume).toBeCloseTo(0.5, 5);
    });

    it('显式 dynamics 覆盖拍位派生', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25, dynamics: 'soft' }),   // 第 1 拍：显式轻音，不该被派生重音
            note({ duration: 0.25, dynamics: 'accent' }), // 第 2 拍：显式重音
        ])], BPM);
        expect(s.events[0].dynamics).toBe('soft');
        expect(s.events[0].volume).toBeCloseTo(0.5 * 0.65, 5);
        expect(s.events[1].dynamics).toBe('accent');
        expect(s.events[1].volume).toBeCloseTo(0.5 * 1.35, 5);
    });

    it('休止符推进拍位：休止后的四分音符落在第 2 拍，不派生重音', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25, isRest: true }),
            note({ duration: 0.25 }),
        ])], BPM);
        expect(s.events).toHaveLength(1);
        expect(s.events[0].dynamics).toBeUndefined();
        expect(s.events[0].volume).toBeCloseTo(0.5, 5);
    });

    it('和弦：未标力度的成员共享拍位派生，显式仍逐音生效', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2, dynamics: 'soft' }),
        ])], BPM);
        expect(s.events[0].dynamics).toBe('accent');
        expect(s.events[0].volume).toBeCloseTo(0.4 * 1.35, 5);
        expect(s.events[1].dynamics).toBe('soft');
        expect(s.events[1].volume).toBeCloseTo(0.4 * 0.65, 5);
    });

    it('3/4 只有第 1 拍派生重音', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
            note({ duration: 0.25 }),
        ], 3, 4)], BPM);
        expect(s.events.map(e => e.dynamics)).toEqual(['accent', undefined, undefined]);
    });

    it('6/8 按附点四分派生（每 3 个八分一次）', () => {
        const s = buildSchedule([measure([
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
            note({ duration: 0.125 }),
        ], 6, 8)], BPM);
        expect(s.events.map(e => e.dynamics))
            .toEqual(['accent', undefined, undefined, 'accent', undefined, undefined]);
    });
});
