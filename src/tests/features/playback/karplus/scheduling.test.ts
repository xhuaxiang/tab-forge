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
        const single = buildSchedule([measure([note({ duration: 0.25 })])], BPM);
        expect(single.events[0].volume).toBeCloseTo(0.5, 5);

        const duo = buildSchedule([measure([
            note({ duration: 0.25, chordGroup: 1 }),
            note({ duration: 0.25, chordGroup: 1, string: 2 }),
        ])], BPM);
        expect(duo.events[0].volume).toBeCloseTo(0.4, 5);

        const triad = buildSchedule([measure([
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
