/**
 * improvPipeline — 本地底稿 + AI 扩展的降级阶梯。
 *
 * 网络两段全部经 `deps` 注入假实现；核心断言是「本地底稿永远先产出」：
 * AI 失败只丢掉扩展，不丢谱。
 */

import { describe, it, expect, vi } from 'vitest';
import { STANDARD_TUNING } from '../../../core/types/tuning/index.ts';
import type { TabScore } from '../../../core/types/index.ts';
import type {
    ImprovBriefOptions,
    ImprovOptions,
    LocalImprovResult,
} from '../../../core/types/improv/index.ts';
import { resolveLocalImprovOptions } from '../../../core/utils/improv/generate.ts';
import type { ImprovPipelineDeps } from '../../../features/ai/improvPipeline.ts';
import { runImprovPipeline } from '../../../features/ai/improvPipeline.ts';
import type {
    ImprovBriefResult,
    ImprovPatchResult,
} from '../../../features/ai/improvService.ts';

// 真实 improvService 会经旧 aiService → systemPromptEditor 拉进 app/dom.ts
// （模块顶层读 statusBar），node 测试环境没有 document。这里只测编排，
// 两段网络请求本来就全部经 deps 注入。
vi.mock('../../../features/ai/improvService.ts', () => ({
    requestImprovBrief: vi.fn(),
    requestImprovPatches: vi.fn(),
}));

const SCORE: TabScore = {
    title: '测试谱',
    artist: '',
    bpm: 90,
    measures: [],
    key: 'C',
    timeSignature: '4/4',
    tuning: { ...STANDARD_TUNING },
};

const BASE: ImprovBriefOptions = {
    numMeasures: 2,
    key: 'C',
    scaleType: 'Major (Ionian)',
    style: 'Rock',
    density: '中',
    timeSignature: '4/4',
};

const EMPTY_BRIEF: ImprovBriefResult = {
    options: {},
    practice: null,
    unsupported: [],
    rationale: '',
    raw: '{}',
};

const EMPTY_PATCH: ImprovPatchResult = {
    patches: [],
    warnings: [],
    raw: '{}',
};

function fakeResult(input: Partial<ImprovOptions>): LocalImprovResult {
    return {
        notes: [],
        options: resolveLocalImprovOptions(input),
        harmony: [],
        phrases: [],
        maxLeapSemitones: 7,
    };
}

function noopDeps(overrides: Partial<ImprovPipelineDeps> = {}): ImprovPipelineDeps {
    return {
        requestBrief: async () => EMPTY_BRIEF,
        requestPatches: async () => EMPTY_PATCH,
        generate: fakeResult,
        ...overrides,
    };
}

describe('runImprovPipeline — 降级', () => {
    it('无 API Key 只出底稿，两段请求都不发', async () => {
        const requestBrief = vi.fn(async () => EMPTY_BRIEF);
        const requestPatches = vi.fn(async () => EMPTY_PATCH);

        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '随便来点',
            apiKey: null,
            seed: 1,
            deps: noopDeps({ requestBrief, requestPatches }),
        });

        expect(result.fatal).toBe(false);
        expect(result.notes).toEqual([]);
        expect(result.local?.options.numMeasures).toBe(2);
        expect(requestBrief).not.toHaveBeenCalled();
        expect(requestPatches).not.toHaveBeenCalled();
        expect(result.messages)
            .toContain('未配置 API Key，已生成本地底稿（AI 扩展跳过）');
    });

    it('brief 抛错时回落到本地关键词解析', async () => {
        const generate = vi.fn(fakeResult);
        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '来一段爵士',
            apiKey: 'key',
            seed: 1,
            deps: noopDeps({
                requestBrief: async () => { throw new Error('超时'); },
                generate,
            }),
        });

        expect(result.fatal).toBe(false);
        expect(result.brief).toBeNull();
        expect(result.messages.some(message => message.startsWith('需求解析失败（超时）')))
            .toBe(true);
        expect(result.merged.style).toBe('Jazz');
        expect(generate.mock.calls[0][0]).toMatchObject({ style: 'Jazz' });
    });

    it('brief 返回 error 时同样回落', async () => {
        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '来一段爵士',
            apiKey: 'key',
            seed: 1,
            deps: noopDeps({
                requestBrief: async () => ({ ...EMPTY_BRIEF, error: 'JSON 坏了' }),
            }),
        });

        expect(result.fatal).toBe(false);
        expect(result.messages)
            .toContain('需求解析失败（JSON 坏了），按本地关键词生成');
        expect(result.merged.style).toBe('Jazz');
    });

    it('patch 失败时保留本地底稿', async () => {
        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '',
            apiKey: 'key',
            seed: 2,
            deps: noopDeps({
                requestPatches: async () => ({
                    ...EMPTY_PATCH,
                    error: '网络错误',
                }),
            }),
        });

        expect(result.fatal).toBe(false);
        expect(result.local).not.toBeNull();
        expect(result.notes).toBe(result.local!.notes);
        expect(result.apply).toBeNull();
        expect(result.messages)
            .toContain('表现扩展失败（网络错误），使用本地底稿');
    });

    it('patch 请求抛错时保留本地底稿', async () => {
        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '',
            apiKey: 'key',
            seed: 2,
            deps: noopDeps({
                requestPatches: async () => { throw new Error('断网'); },
            }),
        });

        expect(result.fatal).toBe(false);
        expect(result.notes).toBe(result.local!.notes);
        expect(result.messages)
            .toContain('表现扩展失败（断网），使用本地底稿');
    });

    it('patch 解析警告进入状态提示', async () => {
        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '',
            apiKey: 'key',
            seed: 2,
            deps: noopDeps({
                requestPatches: async () => ({
                    ...EMPTY_PATCH,
                    patches: [],
                    warnings: ['第 1 条补丁: targetFret 已忽略'],
                }),
            }),
        });

        expect(result.fatal).toBe(false);
        expect(result.messages).toContain(
            '表现扩展解析提示：第 1 条补丁: targetFret 已忽略',
        );
    });
});

describe('runImprovPipeline — 选项合并', () => {
    it('AI 补本地没识别的字段，并作为生成输入', async () => {
        const brief: ImprovBriefResult = {
            options: { style: 'Jazz', numMeasures: 8 },
            practice: 'ear',
            unsupported: ['白键限制'],
            rationale: '按爵士与练耳处理',
            raw: '{}',
        };
        const generate = vi.fn(fakeResult);

        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '来点爵士，练练耳',
            apiKey: 'key',
            seed: 1,
            localParse: {},
            deps: noopDeps({ requestBrief: async () => brief, generate }),
        });

        expect(result.merged).toMatchObject({ style: 'Jazz', numMeasures: 8 });
        expect(generate.mock.calls[0][0]).toMatchObject({
            style: 'Jazz',
            numMeasures: 8,
            practice: 'ear',
        });
    });

    it('本地明确识别与 AI 冲突时按本地执行并提示', async () => {
        const brief: ImprovBriefResult = {
            ...EMPTY_BRIEF,
            options: { key: 'C' },
        };

        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: 'D 大调',
            apiKey: 'key',
            seed: 1,
            localParse: { key: 'D' },
            deps: noopDeps({ requestBrief: async () => brief }),
        });

        expect(result.merged.key).toBe('D');
        expect(result.messages)
            .toContain('AI 与本地识别冲突（key），按本地明确写法执行');
    });
});

describe('runImprovPipeline — 表现扩展接线', () => {
    it('合法补丁经 validateNotes 后写进结果，底稿不变', async () => {
        const local: LocalImprovResult = {
            ...fakeResult({ numMeasures: 2 }),
            notes: [
                { string: 4, fret: 2, duration: 1 },
                { string: 4, fret: 3, duration: 1 },
            ],
        };

        const result = await runImprovPipeline({
            score: SCORE,
            base: { ...BASE, numMeasures: 2 },
            extraPrompt: '',
            apiKey: 'key',
            seed: 2,
            localParse: {},
            deps: noopDeps({
                generate: () => local,
                requestPatches: async () => ({
                    ...EMPTY_PATCH,
                    patches: [{ measureIndex: 0, slotIndex: 0, dynamics: 'accent' }],
                }),
            }),
        });

        expect(result.fatal).toBe(false);
        expect(result.apply?.applied).toBe(1);
        expect(result.notes?.[0].dynamics).toBe('accent');
        expect(local.notes[0].dynamics).toBeUndefined();
    });
});

describe('runImprovPipeline — 指型未套用', () => {
    it('音阶缺该级时给出回退提示，不静默', async () => {
        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '',
            apiKey: null,
            seed: 1,
            localParse: { fingering: 'Si', scaleType: 'Pentatonic Major' },
            deps: noopDeps(),
        });

        expect(result.fatal).toBe(false);
        expect(result.local?.options.fretRangeSource).toBe('style');
        expect(result.messages.some(message =>
            message.startsWith('指型 Si 未能换算到可演奏把位'))).toBe(true);
    });

    it('显式把位与指型并存时不提示未套用', async () => {
        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '',
            apiKey: null,
            seed: 1,
            localParse: { fingering: 'Si', fretRange: { min: 5, max: 8 } },
            deps: noopDeps(),
        });

        expect(result.local?.options.fretRangeSource).toBe('explicit');
        expect(result.messages.some(message =>
            message.startsWith('指型'))).toBe(false);
    });
});

describe('runImprovPipeline — 本地重试阶梯', () => {
    it('指型窗口失败 → 清掉指型/练习后重试', async () => {
        const generate = vi.fn((input: Partial<ImprovOptions>) => {
            if (input.fingering === 'La') throw new Error('窗口过窄');
            return fakeResult(input);
        });

        const result = await runImprovPipeline({
            score: SCORE,
            base: { ...BASE, fingering: 'La' },
            extraPrompt: '',
            apiKey: null,
            seed: 1,
            deps: noopDeps({ generate }),
        });

        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[0][0]).toMatchObject({ fingering: 'La' });
        expect(generate.mock.calls[1][0].fingering).toBeUndefined();
        expect(generate.mock.calls[1][0].fretRange).toBeUndefined();
        expect(generate.mock.calls[1][0].practice).toBe('none');
        expect(result.fatal).toBe(false);
        expect(result.messages).toContain(
            '指型/练习窗口不可用（窗口过窄），已退回风格把位',
        );
    });

    it('和声进行失败 → 去掉进行退回 I 级重试', async () => {
        const generate = vi.fn((input: Partial<ImprovOptions>) => {
            if (input.progression !== undefined) throw new Error('进行不可用');
            return fakeResult(input);
        });

        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '',
            apiKey: null,
            seed: 1,
            localParse: { progression: [1, 5] },
            deps: noopDeps({ generate }),
        });

        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[1][0].progression).toBeUndefined();
        expect(generate.mock.calls[1][0].chordChart).toBeUndefined();
        expect(result.fatal).toBe(false);
        expect(result.messages).toContain(
            '和声进行不可用（进行不可用），已退回 I 级',
        );
    });

    it('AI 建议的把位失败 → 丢掉 AI 把位重试，不丢底稿', async () => {
        const generate = vi.fn((input: Partial<ImprovOptions>) => {
            if (input.fretRange !== undefined) throw new Error('AI 窗口过窄');
            return fakeResult(input);
        });

        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '窄一点',
            apiKey: 'key',
            seed: 1,
            localParse: {},
            deps: noopDeps({
                requestBrief: async () => ({
                    ...EMPTY_BRIEF,
                    options: { fretRange: { min: 5, max: 6 } },
                }),
                generate,
            }),
        });

        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[0][0].fretRange).toEqual({ min: 5, max: 6 });
        expect(generate.mock.calls[1][0].fretRange).toBeUndefined();
        expect(result.fatal).toBe(false);
        expect(result.messages)
            .toContain('AI 建议的把位不可用（AI 窗口过窄），已退回本地把位');
    });

    it('本地指型压过 AI 把位并提示冲突', async () => {
        const generate = vi.fn(fakeResult);

        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: 'C 的 La 指型',
            apiKey: 'key',
            seed: 1,
            localParse: { fingering: 'La' },
            deps: noopDeps({
                requestBrief: async () => ({
                    ...EMPTY_BRIEF,
                    options: { fretRange: { min: 1, max: 4 } },
                }),
                generate,
            }),
        });

        expect(generate.mock.calls[0][0].fretRange).toBeUndefined();
        expect(generate.mock.calls[0][0].fingering).toBe('La');
        expect(result.messages)
            .toContain('AI 建议的把位与本地指型冲突，按指型执行');
    });

    it('显式把位 + AI 独有和声失败 → 只丢 AI 和声，保留显式把位', async () => {
        const generate = vi.fn((input: Partial<ImprovOptions>) => {
            if (input.progression !== undefined) throw new Error('AI 和声不可用');
            return fakeResult(input);
        });

        const result = await runImprovPipeline({
            score: SCORE,
            base: { ...BASE, fretRange: { min: 5, max: 8 } },
            extraPrompt: '用这个进行',
            apiKey: 'key',
            seed: 1,
            localParse: {},
            deps: noopDeps({
                requestBrief: async () => ({
                    ...EMPTY_BRIEF,
                    options: { progression: [1, 6, 4, 5] },
                }),
                generate,
            }),
        });

        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[1][0].fretRange).toEqual({ min: 5, max: 8 });
        expect(generate.mock.calls[1][0].progression).toBeUndefined();
        expect(result.fatal).toBe(false);
        expect(result.messages)
            .toContain('AI 建议的和声进行不可用（AI 和声不可用），已退回 I 级');
    });

    it('显式把位失败不重试，直接中止', async () => {
        const generate = vi.fn(() => {
            throw new Error('显式窗口过窄');
        });

        const result = await runImprovPipeline({
            score: SCORE,
            base: { ...BASE, fretRange: { min: 5, max: 8 } },
            extraPrompt: '',
            apiKey: null,
            seed: 1,
            deps: noopDeps({ generate }),
        });

        expect(generate).toHaveBeenCalledTimes(1);
        expect(result.fatal).toBe(true);
        expect(result.notes).toBeNull();
        expect(result.error).toBe('显式窗口过窄');
        expect(result.messages).toContain('显式把位范围内无法生成，已中止');
    });

    it('本地最终失败时 fatal 并带上错误原文', async () => {
        const result = await runImprovPipeline({
            score: SCORE,
            base: BASE,
            extraPrompt: '',
            apiKey: null,
            seed: 1,
            deps: noopDeps({
                generate: () => { throw new Error('生成器内部错误'); },
            }),
        });

        expect(result.fatal).toBe(true);
        expect(result.notes).toBeNull();
        expect(result.error).toBe('生成器内部错误');
    });
});
