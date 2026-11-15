/**
 * improvService — 两段请求的 user prompt 构造（纯函数部分）。
 *
 * 拍位表一旦序列化偏差，AI 补丁会定位到错拍，所以这里钉住：
 * 休止占 slotIndex、和弦组与和弦名按小节编号、把位来源可见。
 */

import { describe, it, expect, vi } from 'vitest';
import { STANDARD_TUNING } from '../../../core/types/tuning/index.ts';
import type { TabScore } from '../../../core/types/index.ts';
import type {
    ImprovBriefOptions,
    LocalImprovResult,
} from '../../../core/types/improv/index.ts';
import {
    generateLocalImprovisation,
    resolveLocalImprovOptions,
} from '../../../core/utils/improv/generate.ts';
import type { Note } from '../../../core/types/index.ts';
import {
    buildBriefUserPrompt,
    buildPatchUserPrompt,
} from '../../../features/ai/improvService.ts';

// 真实 aiService → systemPromptEditor 在模块顶层读 document，node 环境跑不了
vi.mock('../../../features/ai/aiService.ts', () => ({
    callDeepSeek: vi.fn(),
    getApiKey: vi.fn(async () => null),
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
    style: 'Folk',
    density: '中',
    timeSignature: '4/4',
};

describe('buildBriefUserPrompt', () => {
    it('包含乐谱、面板选项与本地解析结果', () => {
        const text = buildBriefUserPrompt({
            score: SCORE,
            base: BASE,
            localParse: { fingering: 'La', progression: [1, 5] },
            extraPrompt: '主要在 C 的 La 指型上即兴',
        });

        expect(text).toContain('## 当前乐谱');
        expect(text).toContain('- 调性：C');
        expect(text).toContain('- 拍号：4/4');
        expect(text).toContain('- 小节数：2');
        expect(text).toContain('"fingering": "La"');
        expect(text).toContain('主要在 C 的 La 指型上即兴');
        expect(text).toContain('请按要求输出 JSON。');
    });

    it('空解析与空要求显示占位', () => {
        const text = buildBriefUserPrompt({
            score: SCORE,
            base: BASE,
            localParse: {},
            extraPrompt: '   ',
        });

        expect(text).toContain('（无）');
    });
});

describe('buildPatchUserPrompt', () => {
    function localOf(notes: Note[], fretRange?: { min: number; max: number }): LocalImprovResult {
        return {
            notes,
            options: resolveLocalImprovOptions({
                key: 'C',
                scaleType: 'Major (Ionian)',
                style: 'Folk',
                density: '中',
                numMeasures: 1,
                timeSignature: '4/4',
                fretRange,
            }),
            harmony: [],
            phrases: [],
            maxLeapSemitones: 7,
        };
    }

    it('休止占 slotIndex，拍位表可见', () => {
        const text = buildPatchUserPrompt({
            score: SCORE,
            local: localOf([
                { string: 4, fret: 2, duration: 0.5 },
                { duration: 0.5, isRest: true },
            ]),
            extraPrompt: '',
        });

        // 休止占 1 号拍位，后面的 AI 补丁才能对准
        expect(text).toMatch(/"slotIndex":\s*1[\s\S]*"rest":\s*true/);
        expect(text).toContain('- （无和声信息）');
        expect(text).toContain('最多返回');
    });

    it('把位来源与和弦名写进 prompt', () => {
        const local = generateLocalImprovisation({
            key: 'C',
            scaleType: 'Major (Ionian)',
            style: 'Folk',
            density: '中',
            numMeasures: 1,
            timeSignature: '4/4',
            fretRange: { min: 5, max: 8 },
            seed: 3,
        });

        const text = buildPatchUserPrompt({ score: SCORE, local, extraPrompt: '' });

        expect(text).toContain('- 把位：5-8 品（来源：explicit）');
        expect(text).toContain('- 第 1 小节：');
        expect(text).toContain('"slotIndex": 0');
    });
});
