/**
 * improvPatchParser — AI「表现扩展」响应的逐条白名单校验。
 *
 * 结构非法整条丢弃；单个字段非法只丢字段；音高/时值/分组字段没有
 * 落点（`PerformancePatch` 不含这些键），`targetFret` 额外提示一次。
 */

import { describe, it, expect } from 'vitest';
import { parseImprovPatchesResponse } from '../../../features/ai/improvPatchParser.ts';

function parse(patches: unknown, maxPatches = 128) {
    return parseImprovPatchesResponse(
        JSON.stringify({ patches }),
        maxPatches,
    );
}

describe('parseImprovPatchesResponse — 正常解析', () => {
    it('完整补丁字段原样保留', () => {
        const result = parse([{
            measureIndex: 1,
            slotIndex: 2,
            dynamics: 'accent',
            technique: 'bend',
            bendAmount: 0.5,
            bendRelease: true,
            palmMute: true,
            deadNote: false,
            letRing: null,
            staccato: false,
            harmonic: 'artificial',
            harmonicFret: 12,
            arpeggio: 'up',
            strum: 'down',
        }]);

        expect(result.error).toBeUndefined();
        expect(result.warnings).toEqual([]);
        expect(result.patches).toEqual([{
            measureIndex: 1,
            slotIndex: 2,
            dynamics: 'accent',
            technique: 'bend',
            bendAmount: 0.5,
            bendRelease: true,
            palmMute: true,
            deadNote: false,
            letRing: null,
            staccato: false,
            harmonic: 'artificial',
            harmonicFret: 12,
            arpeggio: 'up',
            strum: 'down',
        }]);
    });

    it('只写要改的字段时不会补默认值', () => {
        const result = parse([{ measureIndex: 0, slotIndex: 0, dynamics: 'soft' }]);
        expect(result.patches).toEqual([
            { measureIndex: 0, slotIndex: 0, dynamics: 'soft' },
        ]);
    });

    it('泛音触弦点先规范化，再按可演奏白名单过滤', () => {
        // 6 品在 alphaTab 表外，回落到 12 品 —— 白名单内，保留规范化后的值
        const tableOut = parse([{ measureIndex: 0, slotIndex: 0, harmonicFret: 6 }]);
        expect(tableOut.patches[0].harmonicFret).toBe(12);
        expect(tableOut.warnings).toEqual([]);

        // 15 / 22 规范化成 14 / 21，但本地只支持 12，字段被丢弃
        for (const harmonicFret of [7, 15, 22]) {
            const result = parse([{ measureIndex: 0, slotIndex: 0, harmonicFret }]);
            expect(result.patches[0].harmonicFret).toBeUndefined();
            expect(result.warnings[0]).toContain('不在支持范围');
        }
    });

    it('未知字段被忽略，不影响同条补丁', () => {
        const result = parse([{
            measureIndex: 0,
            slotIndex: 1,
            dynamics: 'accent',
            foo: 'bar',
        }]);
        expect(result.patches).toEqual([
            { measureIndex: 0, slotIndex: 1, dynamics: 'accent' },
        ]);
        expect(result.warnings).toEqual([]);
    });

    it('markdown 代码块与解释文字包裹仍能解析', () => {
        const result = parseImprovPatchesResponse(
            '结果如下：\n```json\n{"patches":[{"measureIndex":0,"slotIndex":0}]}\n```',
            128,
        );
        expect(result.error).toBeUndefined();
        expect(result.patches).toEqual([{ measureIndex: 0, slotIndex: 0 }]);
    });
});

describe('parseImprovPatchesResponse — 顶层与结构非法', () => {
    it('非 JSON / 缺少 patches 数组时报错', () => {
        expect(parseImprovPatchesResponse('坏 JSON', 128).error)
            .toBe('AI 响应缺少 patches 数组或不是合法 JSON');
        expect(parseImprovPatchesResponse('{"patches":{}}', 128).error)
            .toBe('AI 响应缺少 patches 数组或不是合法 JSON');
    });

    it('非对象补丁整条丢弃并给 warning', () => {
        const result = parse(['not an object', null, 3]);
        expect(result.patches).toEqual([]);
        expect(result.warnings).toHaveLength(3);
        expect(result.warnings[0]).toContain('不是对象');
    });

    it('measureIndex / slotIndex 非法时整条丢弃', () => {
        for (const bad of [
            { measureIndex: -1, slotIndex: 0 },
            { measureIndex: 0, slotIndex: -1 },
            { measureIndex: 1.5, slotIndex: 0 },
            { measureIndex: 0, slotIndex: '0' },
            { slotIndex: 0 },
        ]) {
            const result = parse([bad]);
            expect(result.patches).toEqual([]);
            expect(result.warnings[0]).toContain('measureIndex/slotIndex 非法');
        }
    });

    it('targetFret 丢弃并提示连接技法的目标就是自身 fret', () => {
        const result = parse([{
            measureIndex: 0,
            slotIndex: 0,
            technique: 'hammerOn',
            targetFret: 9,
        }]);
        expect(result.patches).toEqual([
            { measureIndex: 0, slotIndex: 0, technique: 'hammerOn' },
        ]);
        expect(result.warnings).toContain(
            '第 1 条补丁: targetFret 已忽略——连接技法的目标就是该音自身的 fret',
        );
    });
});

describe('parseImprovPatchesResponse — 字段白名单', () => {
    it('力度 / 技法 / 泛音非法时只丢字段并 warning', () => {
        const result = parse([{
            measureIndex: 0,
            slotIndex: 0,
            dynamics: 'forte',
            technique: 'tapping',
            harmonic: 'feedback',
        }]);
        expect(result.patches).toEqual([{ measureIndex: 0, slotIndex: 0 }]);
        expect(result.warnings).toEqual([
            '第 1 条补丁: 力度 "forte" 非法，已忽略该字段',
            '第 1 条补丁: 技法 "tapping" 非法，已忽略该字段',
            '第 1 条补丁: 泛音类型 "feedback" 非法，已忽略该字段',
        ]);
    });

    it('推弦幅度只认 0.25 / 0.5 / 1', () => {
        expect(parse([{ measureIndex: 0, slotIndex: 0, bendAmount: 1 }])
            .patches[0].bendAmount).toBe(1);
        const bad = parse([{ measureIndex: 0, slotIndex: 0, bendAmount: 0.75 }]);
        expect(bad.patches[0].bendAmount).toBeUndefined();
        expect(bad.warnings[0]).toContain('推弦幅度非法');
    });

    it('bendRelease 必须是布尔值', () => {
        const result = parse([{ measureIndex: 0, slotIndex: 0, bendRelease: 1 }]);
        expect(result.patches[0].bendRelease).toBeUndefined();
        expect(result.warnings[0]).toContain('bendRelease 必须是布尔值');
    });

    it('布尔奏法字段只认 true / false / null', () => {
        const result = parse([{
            measureIndex: 0,
            slotIndex: 0,
            palmMute: 'true',
            deadNote: 1,
            letRing: null,
            staccato: true,
        }]);
        expect(result.patches[0]).toEqual({
            measureIndex: 0,
            slotIndex: 0,
            letRing: null,
            staccato: true,
        });
        expect(result.warnings).toEqual([
            '第 1 条补丁: palmMute 必须是布尔值或 null，已忽略该字段',
            '第 1 条补丁: deadNote 必须是布尔值或 null，已忽略该字段',
        ]);
    });

    it('泛音触弦点越界或非整数时丢字段', () => {
        for (const harmonicFret of [0, 25, 7.5, '7']) {
            const result = parse([{ measureIndex: 0, slotIndex: 0, harmonicFret }]);
            expect(result.patches[0].harmonicFret).toBeUndefined();
            expect(result.warnings[0]).toContain('泛音触弦品位非法');
        }
    });

    it('琶音 / 扫弦只认 up / down / null', () => {
        const result = parse([{
            measureIndex: 0,
            slotIndex: 0,
            arpeggio: 'sideways',
            strum: null,
        }]);
        expect(result.patches[0]).toEqual({
            measureIndex: 0,
            slotIndex: 0,
            strum: null,
        });
        expect(result.warnings).toEqual([
            '第 1 条补丁: 琶音方向非法，已忽略该字段',
        ]);
    });
});

describe('parseImprovPatchesResponse — 条数上限', () => {
    it('超过上限时截断并 warning', () => {
        const result = parse([
            { measureIndex: 0, slotIndex: 0 },
            { measureIndex: 0, slotIndex: 1 },
            { measureIndex: 0, slotIndex: 2 },
        ], 2);

        expect(result.patches).toHaveLength(2);
        expect(result.warnings).toContain('补丁超过上限 2 条，其余已忽略');
    });

    it('非法 maxPatches 时不做截断', () => {
        const input = [
            { measureIndex: 0, slotIndex: 0 },
            { measureIndex: 0, slotIndex: 1 },
        ];
        expect(parse(input, Number.NaN).patches).toHaveLength(2);
        expect(parse(input, -1).patches).toHaveLength(2);
    });
});
