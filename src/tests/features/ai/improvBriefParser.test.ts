/**
 * improvBriefParser — AI「需求解析」响应的逐字段白名单校验。
 *
 * AI 输出按不可信处理：坏字段单独丢弃，只有 JSON / options 结构坏了
 * 才整包失败（调用方据此回落到本地关键词解析）。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../core/config.ts';
import { parseImprovBriefResponse } from '../../../features/ai/improvBriefParser.ts';

function parse(raw: unknown) {
    return parseImprovBriefResponse(
        typeof raw === 'string' ? raw : JSON.stringify(raw),
    );
}

describe('parseImprovBriefResponse — 正常解析', () => {
    it('完整字段一次通过', () => {
        const result = parse({
            options: {
                key: 'C',
                scaleType: 'Major (Ionian)',
                style: 'Rock',
                density: '中',
                numMeasures: 8,
                timeSignature: '4/4',
                fingering: 'La',
                fretRange: { min: 5, max: 8 },
                progression: 'I-V-vi-IV',
                chordsPerMeasure: 2,
            },
            practice: 'fretboard',
            unsupported: ['三连音'],
            rationale: '用户要求在 C 的 La 指型内练习。',
        });

        expect(result.error).toBeUndefined();
        expect(result.options).toEqual({
            key: 'C',
            scaleType: 'Major (Ionian)',
            style: 'Rock',
            density: '中',
            numMeasures: 8,
            timeSignature: '4/4',
            fingering: 'La',
            fretRange: { min: 5, max: 8 },
            progression: [1, 5, 6, 4],
            chordsPerMeasure: 2,
        });
        expect(result.practice).toBe('fretboard');
        expect(result.unsupported).toEqual(['三连音']);
        expect(result.rationale).toBe('用户要求在 C 的 La 指型内练习。');
    });

    it('接受小调写法与和弦名进行的转换', () => {
        const result = parse({
            options: { key: 'Am', progression: 'C G Am F' },
            practice: null,
        });
        expect(result.error).toBeUndefined();
        expect(result.options.key).toBe('Am');
        expect(result.options.progression).toEqual([
            { rootPitchClass: 0, quality: 'major' },
            { rootPitchClass: 7, quality: 'major' },
            { rootPitchClass: 9, quality: 'minor' },
            { rootPitchClass: 5, quality: 'major' },
        ]);
        expect(result.practice).toBeNull();
    });

    it('markdown 代码块与前后解释文字都能提取 JSON', () => {
        const result = parse(
            '好的，解析如下：\n```json\n{"options":{"key":"D"},"practice":"ear"}\n```',
        );
        expect(result.error).toBeUndefined();
        expect(result.options.key).toBe('D');
        expect(result.practice).toBe('ear');
    });
});

describe('parseImprovBriefResponse — 顶层结构非法', () => {
    it('非 JSON 时报错并给出空 options', () => {
        const result = parseImprovBriefResponse('这不是 JSON');
        expect(result.error).toBe('AI 响应不是合法 JSON');
        expect(result.options).toEqual({});
        expect(result.practice).toBeNull();
    });

    it('缺少 options 对象时报错', () => {
        const result = parse({ practice: 'ear' });
        expect(result.error).toBe('AI 返回的 JSON 缺少 options 对象');
        expect(result.options).toEqual({});
    });

    it('options 是数组同样视为缺失', () => {
        expect(parse({ options: [] }).error)
            .toBe('AI 返回的 JSON 缺少 options 对象');
    });
});

describe('parseImprovBriefResponse — 逐字段白名单', () => {
    it('非法字段逐项丢弃，不影响其他字段', () => {
        const result = parse({
            options: {
                key: 'H',
                scaleType: 'Techno',
                style: 'Metal',
                density: '极高',
                timeSignature: '11/16',
                fingering: 'Do',
                progression: '不是进行',
                chordsPerMeasure: 3,
                fretRange: { min: '5', max: 8 },
            },
        });

        expect(result.error).toBeUndefined();
        expect(result.options).toEqual({});
    });

    it('小节数夹到配置范围，非整数直接丢弃', () => {
        expect(parse({ options: { numMeasures: 99 } }).options.numMeasures)
            .toBe(LOCAL_IMPROV_CONFIG.numMeasures.max);
        expect(parse({ options: { numMeasures: 1 } }).options.numMeasures)
            .toBe(LOCAL_IMPROV_CONFIG.numMeasures.min);
        expect(parse({ options: { numMeasures: 4.5 } }).options).toEqual({});
    });

    it('把位范围夹到可演奏范围并纠正反向区间', () => {
        expect(parse({ options: { fretRange: { min: -3, max: 30 } } }).options.fretRange)
            .toEqual({
                min: LOCAL_IMPROV_CONFIG.playability.fretMin,
                max: LOCAL_IMPROV_CONFIG.playability.fretMax,
            });
        expect(parse({ options: { fretRange: { min: 10, max: 3 } } }).options.fretRange)
            .toEqual({ min: 3, max: 10 });
        expect(parse({ options: { fretRange: { min: 5 } } }).options.fretRange)
            .toBeUndefined();
    });

    it('practice 不在白名单时置 null，缺省同样是 null', () => {
        expect(parse({ options: {}, practice: 'shred' }).practice).toBeNull();
        expect(parse({ options: {} }).practice).toBeNull();
    });

    it('unsupported 只留字符串、去空、最多 5 条', () => {
        const result = parse({
            options: {},
            unsupported: [
                '一', '二', '三', '四', '五', '六',
                42,
                '   ',
            ],
        });
        expect(result.unsupported).toEqual(['一', '二', '三', '四', '五']);
    });

    it('unsupported 每条截到 200 字', () => {
        const result = parse({
            options: {},
            unsupported: ['长'.repeat(300), '短'],
        });
        expect(result.unsupported).toEqual(['长'.repeat(200), '短']);
    });

    it('rationale 非字符串置空，超长截到 300 字', () => {
        expect(parse({ options: {}, rationale: 123 }).rationale).toBe('');
        expect(parse({ options: {}, rationale: '理'.repeat(400) }).rationale)
            .toBe('理'.repeat(300));
    });
});
