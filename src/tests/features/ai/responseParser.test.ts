/**
 * responseParser 单元测试 —— AI 原始文本 → Note[] 的解析与边界校验
 *
 * 覆盖：顶层结构校验（measures）、markdown/解释文字包裹的提取、非法 JSON，
 * 以及 sanitizeNote 的逐字段边界（弦/品越界、时值规范化、技法白名单、和弦与延音字段）。
 */

import { describe, it, expect, vi } from 'vitest';
import type { Note } from '../../../core/types/index.ts';
import { parseAIResponse } from '../../../features/ai/responseParser.ts';

/** 把一个原始音符塞进 measures 外壳后解析，返回首个 note（无则 undefined） */
function parseOne(rawNote: Record<string, unknown>): Note | undefined {
    const { notes } = parseAIResponse(JSON.stringify({ measures: [{ notes: [rawNote] }] }));
    return notes[0];
}

/** 包装成完整响应文本 */
function wrap(rawNote: Record<string, unknown>): string {
    return JSON.stringify({ measures: [{ notes: [rawNote] }] });
}

describe('parseAIResponse — 正常解析', () => {
    it('单个音符的 happy path，无 error 且字段完整', () => {
        const result = parseAIResponse(
            '{"measures":[{"notes":[{"string":1,"fret":3,"duration":0.25}]}]}'
        );

        expect(result.error).toBeUndefined();
        expect(result.notes).toEqual([{ string: 1, fret: 3, duration: 0.25 }]);
    });

    it('markdown 代码块包裹仍能解析出 JSON', () => {
        const raw = '```json\n{"measures":[{"notes":[{"string":2,"fret":5,"duration":0.5}]}]}\n```';
        const result = parseAIResponse(raw);

        expect(result.error).toBeUndefined();
        expect(result.notes).toEqual([{ string: 2, fret: 5, duration: 0.5 }]);
    });

    it('JSON 前后带解释文字时按首尾花括号截取', () => {
        const raw = '好的，这是扒谱结果：\n{"measures":[{"notes":[{"string":3,"fret":7,"duration":0.125}]}]}\n希望有帮助！';
        const result = parseAIResponse(raw);

        expect(result.error).toBeUndefined();
        expect(result.notes).toEqual([{ string: 3, fret: 7, duration: 0.125 }]);
    });

    it('多个小节 / 多个音符按顺序聚合', () => {
        const raw = JSON.stringify({
            measures: [
                { notes: [{ string: 1, fret: 0, duration: 0.25 }, { string: 2, fret: 2, duration: 0.25 }] },
                { notes: [{ string: 3, fret: 4, duration: 0.5 }] },
            ],
        });
        const { notes, error } = parseAIResponse(raw);

        expect(error).toBeUndefined();
        expect(notes.map(n => [n.string, n.fret])).toEqual([[1, 0], [2, 2], [3, 4]]);
    });

    it('measures 中缺 notes 字段的小节被跳过，不影响其它小节', () => {
        const raw = JSON.stringify({
            measures: [{}, { notes: [{ string: 1, fret: 3, duration: 0.25 }] }],
        });
        const { notes, error } = parseAIResponse(raw);

        expect(error).toBeUndefined();
        expect(notes).toHaveLength(1);
    });
});

describe('parseAIResponse — 顶层结构缺失', () => {
    it('对象里没有 measures → 报缺少 measures 数组', () => {
        const result = parseAIResponse('{"foo":1}');
        expect(result.notes).toEqual([]);
        expect(result.error).toBe('AI 返回的 JSON 中缺少 measures 数组');
    });

    it('measures 不是数组 → 报缺少 measures 数组', () => {
        const result = parseAIResponse('{"measures":"nope"}');
        expect(result.notes).toEqual([]);
        expect(result.error).toBe('AI 返回的 JSON 中缺少 measures 数组');
    });

    it('measures 为空数组 → 报没有有效音符', () => {
        const result = parseAIResponse('{"measures":[]}');
        expect(result.notes).toEqual([]);
        expect(result.error).toBe('AI 返回的 measures 中没有有效音符');
    });

    it('小节里没有 notes 或 notes 为空 → 报没有有效音符', () => {
        expect(parseAIResponse('{"measures":[{}]}').error).toBe('AI 返回的 measures 中没有有效音符');
        expect(parseAIResponse('{"measures":[{"notes":[]}]}').error).toBe('AI 返回的 measures 中没有有效音符');
    });

    it('全部音符都越界被丢弃 → 报没有有效音符', () => {
        const raw = JSON.stringify({ measures: [{ notes: [{ string: 0, fret: 3, duration: 0.25 }] }] });
        const result = parseAIResponse(raw);
        expect(result.notes).toEqual([]);
        expect(result.error).toBe('AI 返回的 measures 中没有有效音符');
    });
});

describe('parseAIResponse — 非法 JSON', () => {
    it('非 JSON 文本 → error 以「AI 响应解析错误:」开头且 notes 为空', () => {
        const result = parseAIResponse('这根本不是 JSON');
        expect(result.notes).toEqual([]);
        expect(result.error).toMatch(/^AI 响应解析错误:/);
    });

    it('花括号内语法错乱 → error 以「AI 响应解析错误:」开头', () => {
        const result = parseAIResponse('{ measures: [ }');
        expect(result.notes).toEqual([]);
        expect(result.error).toMatch(/^AI 响应解析错误:/);
    });

    it('空字符串 → error 以「AI 响应解析错误:」开头', () => {
        const result = parseAIResponse('');
        expect(result.notes).toEqual([]);
        expect(result.error).toMatch(/^AI 响应解析错误:/);
    });
});

describe('时值 duration 规范化', () => {
    it('合法时值原样保留', () => {
        for (const d of [1, 0.5, 0.25, 0.125, 0.0625, 0.03125]) {
            expect(parseOne({ string: 1, fret: 3, duration: d })?.duration).toBe(d);
        }
    });

    it('0.3 → 最近合法值 0.25', () => {
        expect(parseOne({ string: 1, fret: 3, duration: 0.3 })?.duration).toBe(0.25);
    });

    it('0.1 → 最近合法值 0.125', () => {
        expect(parseOne({ string: 1, fret: 3, duration: 0.1 })?.duration).toBe(0.125);
    });

    it('超过全音符的 2 → 夹到 1', () => {
        expect(parseOne({ string: 1, fret: 3, duration: 2 })?.duration).toBe(1);
    });

    it('缺省（undefined）→ 回落到默认 0.25', () => {
        expect(parseOne({ string: 1, fret: 3 })?.duration).toBe(0.25);
    });

    it('duration: 0 → 取距 0 最近的 0.03125（“0 回落到 0.25”并不成立）', () => {
        // clampDuration 里 `d ?? 0.25` 只对 null/undefined 生效，0 会原样参与取最近，
        // 故 0 落在最小时值而非默认四分音符。
        expect(parseOne({ string: 1, fret: 3, duration: 0 })?.duration).toBe(0.03125);
    });
});

describe('弦号 string 边界', () => {
    it('string 0 越界 → 该音符被丢弃', () => {
        const { notes, error } = parseAIResponse(wrap({ string: 0, fret: 3, duration: 0.25 }));
        expect(notes).toEqual([]);
        expect(error).toBe('AI 返回的 measures 中没有有效音符');
    });

    it('string 7 越界 → 该音符被丢弃', () => {
        expect(parseAIResponse(wrap({ string: 7, fret: 3, duration: 0.25 })).notes).toEqual([]);
    });

    it('string 1 / 6 边界内保留', () => {
        expect(parseOne({ string: 1, fret: 0, duration: 0.25 })?.string).toBe(1);
        expect(parseOne({ string: 6, fret: 0, duration: 0.25 })?.string).toBe(6);
    });

    it('string 缺省 → 默认 1', () => {
        expect(parseOne({ fret: 3, duration: 0.25 })?.string).toBe(1);
    });
});

describe('品位 fret 边界', () => {
    it('fret -1 越界 → 该音符被丢弃', () => {
        const { notes, error } = parseAIResponse(wrap({ string: 1, fret: -1, duration: 0.25 }));
        expect(notes).toEqual([]);
        expect(error).toBe('AI 返回的 measures 中没有有效音符');
    });

    it('fret 25 越界 → 该音符被丢弃', () => {
        expect(parseAIResponse(wrap({ string: 1, fret: 25, duration: 0.25 })).notes).toEqual([]);
    });

    it('fret 0（空弦）/ 24 边界内保留', () => {
        expect(parseOne({ string: 1, fret: 0, duration: 0.25 })?.fret).toBe(0);
        expect(parseOne({ string: 1, fret: 24, duration: 0.25 })?.fret).toBe(24);
    });

    it('fret 缺省 → 默认 0', () => {
        expect(parseOne({ string: 1, duration: 0.25 })?.fret).toBe(0);
    });
});

describe('休止符', () => {
    it('isRest: true → 只带 isRest 与 duration', () => {
        const note = parseOne({ isRest: true, duration: 0.5 });
        expect(note).toEqual({ isRest: true, duration: 0.5 });
        expect(note).not.toHaveProperty('string');
        expect(note).not.toHaveProperty('fret');
    });

    it('休止符即使带越界 string/fret 也不被丢弃', () => {
        const note = parseOne({ isRest: true, string: 0, fret: 99, duration: 0.25 });
        expect(note).toEqual({ isRest: true, duration: 0.25 });
    });

    it('休止符的非法 duration 同样被规范化', () => {
        expect(parseOne({ isRest: true, duration: 0.3 })?.duration).toBe(0.25);
    });
});

describe('技法 technique', () => {
    it('hammerOn 合法 → 保留，targetFret 在 0-24 内一并保留', () => {
        const note = parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'hammerOn', targetFret: 5 });
        expect(note).toEqual({ string: 1, fret: 3, duration: 0.25, technique: 'hammerOn', targetFret: 5 });
    });

    it('pullOff / slide 同样被白名单接受', () => {
        expect(parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'pullOff' })?.technique).toBe('pullOff');
        expect(parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'slide' })?.technique).toBe('slide');
    });

    it('targetFret 边界 0 / 24 保留', () => {
        expect(parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'slide', targetFret: 0 })?.targetFret).toBe(0);
        expect(parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'slide', targetFret: 24 })?.targetFret).toBe(24);
    });

    it('targetFret 越界（-1 / 25）→ 技法保留但 targetFret 被丢弃', () => {
        const low = parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'slide', targetFret: -1 });
        expect(low?.technique).toBe('slide');
        expect(low).not.toHaveProperty('targetFret');

        const high = parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'slide', targetFret: 25 });
        expect(high?.technique).toBe('slide');
        expect(high).not.toHaveProperty('targetFret');
    });

    it('bend 是合法技法：保留 technique，并按 bendAmount 校验', () => {
        const note = parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'bend', bendAmount: 0.5 });
        expect(note).toEqual({ string: 1, fret: 3, duration: 0.25, technique: 'bend', bendAmount: 0.5 });

        const full = parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'bend', bendAmount: 1, bendRelease: true });
        expect(full).toEqual({ string: 1, fret: 3, duration: 0.25, technique: 'bend', bendAmount: 1, bendRelease: true });
    });

    it('bendAmount 非法（0.3 / 缺席 / 非数字）→ 回落到全音 1，技法仍保留', () => {
        for (const bad of [{ bendAmount: 0.3 }, {}, { bendAmount: 'big' }]) {
            const note = parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'bend', ...bad });
            expect(note?.technique).toBe('bend');
            expect(note?.bendAmount).toBe(1);
        }
    });

    it('bendAmount / bendRelease 只在 technique=bend 时才写入', () => {
        const note = parseOne({
            string: 1, fret: 3, duration: 0.25,
            technique: 'slide', bendAmount: 1, bendRelease: true,
        });
        expect(note).toEqual({ string: 1, fret: 3, duration: 0.25, technique: 'slide' });
    });

    it('vibrato 是合法技法', () => {
        expect(parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'vibrato' }))
            .toEqual({ string: 1, fret: 3, duration: 0.25, technique: 'vibrato' });
    });

    it('未知技法（tapping / 乱码）丢弃技法但保留音符，且 console.warn', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'tapping' }))
            .toEqual({ string: 1, fret: 3, duration: 0.25 });
        expect(parseOne({ string: 1, fret: 3, duration: 0.25, technique: 'nonsense' }))
            .toEqual({ string: 1, fret: 3, duration: 0.25 });
        expect(warn).toHaveBeenCalledTimes(2);

        warn.mockRestore();
    });

    it('technique 为 null → 不写字段也不告警', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const note = parseOne({ string: 1, fret: 3, duration: 0.25, technique: null });

        expect(note).toEqual({ string: 1, fret: 3, duration: 0.25 });
        expect(warn).not.toHaveBeenCalled();

        warn.mockRestore();
    });
});

describe('力度 dynamics', () => {
    it('accent / soft 被保留', () => {
        expect(parseOne({ string: 1, fret: 3, duration: 0.25, dynamics: 'accent' })?.dynamics).toBe('accent');
        expect(parseOne({ string: 1, fret: 3, duration: 0.25, dynamics: 'soft' })?.dynamics).toBe('soft');
    });

    it('非法力度取值不写入（也不报错）', () => {
        for (const bad of ['loud', 'fff', '', 3]) {
            const note = parseOne({ string: 1, fret: 3, duration: 0.25, dynamics: bad });
            expect(note).toEqual({ string: 1, fret: 3, duration: 0.25 });
        }
    });

    it('dynamics 为 null → 不写字段', () => {
        expect(parseOne({ string: 1, fret: 3, duration: 0.25, dynamics: null }))
            .toEqual({ string: 1, fret: 3, duration: 0.25 });
    });
});

describe('和弦与延音字段', () => {
    it('有 chordGroup 时 arpeggio / strum 一并保留', () => {
        const note = parseOne({
            string: 1, fret: 3, duration: 0.25,
            chordGroup: 1, arpeggio: 'up', strum: 'down',
        });
        expect(note).toEqual({
            string: 1, fret: 3, duration: 0.25,
            chordGroup: 1, arpeggio: 'up', strum: 'down',
        });
    });

    it('没有 chordGroup 时 arpeggio / strum 不写入', () => {
        const note = parseOne({ string: 1, fret: 3, duration: 0.25, arpeggio: 'up', strum: 'down' });
        expect(note).toEqual({ string: 1, fret: 3, duration: 0.25 });
        expect(note).not.toHaveProperty('chordGroup');
    });

    it('chordGroup 为 0 仍视为存在（保留 arpeggio）', () => {
        const note = parseOne({ string: 1, fret: 3, duration: 0.25, chordGroup: 0, arpeggio: 'down' });
        expect(note).toEqual({ string: 1, fret: 3, duration: 0.25, chordGroup: 0, arpeggio: 'down' });
    });

    it('arpeggio / strum 取值非法时不写入', () => {
        const note = parseOne({
            string: 1, fret: 3, duration: 0.25,
            chordGroup: 1, arpeggio: 'sideways', strum: 3,
        });
        expect(note).toEqual({ string: 1, fret: 3, duration: 0.25, chordGroup: 1 });
    });

    it('tieToNext: true 保留', () => {
        const note = parseOne({ string: 1, fret: 3, duration: 0.25, tieToNext: true });
        expect(note).toEqual({ string: 1, fret: 3, duration: 0.25, tieToNext: true });
    });

    it('tieToNext: false 不写入该字段', () => {
        const note = parseOne({ string: 1, fret: 3, duration: 0.25, tieToNext: false });
        expect(note).toEqual({ string: 1, fret: 3, duration: 0.25 });
        expect(note).not.toHaveProperty('tieToNext');
    });
});

describe('全字段往返（防「字段加了但解析器忘了收」）', () => {
    it('AI 能写的字段一个都不丢', () => {
        // 这条用「所有字段塞进一个音符」的方式做往返：漏收任何一个字段，
        // 下面的 toEqual 就会不通过。同类的静默丢字段已经真实发生过一次
        // （bendAmount / bendRelease 在 Note 里有、解析器里没有）。
        const note = parseOne({
            string: 3, fret: 7, duration: 0.25,
            technique: 'bend', targetFret: 5, bendAmount: 0.5, bendRelease: true,
            dynamics: 'accent', tieToNext: true, chordGroup: 2,
            strum: 'down',
        });
        expect(note).toEqual({
            string: 3, fret: 7, duration: 0.25,
            technique: 'bend', targetFret: 5, bendAmount: 0.5, bendRelease: true,
            dynamics: 'accent', tieToNext: true, chordGroup: 2,
            strum: 'down',
        });
    });

    it('没有字段被漏掉：结果里有值的字段数 == 输入里给了值的字段数', () => {
        const raw = {
            string: 2, fret: 5, duration: 0.5,
            technique: 'vibrato', dynamics: 'soft', tieToNext: true,
            chordGroup: 4, arpeggio: 'up',
        };
        const note = parseOne(raw) as unknown as Record<string, unknown>;
        const inputKeys = Object.keys(raw).sort();
        const outputKeys = Object.keys(note).sort();
        expect(outputKeys).toEqual(inputKeys);
    });
});
