/**
 * improvSummary — 状态栏摘要里的指型展示。
 *
 * 指型只有真正决定把位（或用户显式给了范围）时才按「已套用」显示；
 * 换算失败回退风格/练习窗口时必须标注，避免「风格把位 · 指型 Sol」自相矛盾。
 */

import { afterEach, describe, it, expect } from 'vitest';
import type { Note } from '../../../core/types/index.ts';
import type { LocalImprovResult } from '../../../core/types/improv/index.ts';
import { resolveLocalImprovOptions } from '../../../core/utils/improv/generate.ts';
import { buildImprovSummary } from '../../../app/controls/improvSummary.ts';
import { setLocale } from '../../../core/i18n/index.ts';

afterEach(() => setLocale('zh-CN'));

const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

function result(options: Parameters<typeof resolveLocalImprovOptions>[0]): LocalImprovResult {
    const notes: Note[] = [{ string: 1, fret: 5, duration: 0.25 }];
    return {
        notes,
        options: resolveLocalImprovOptions(options),
        harmony: [],
        phrases: [],
        maxLeapSemitones: 7,
    };
}

function summary(local: LocalImprovResult, warnings: string[] = []): string {
    return buildImprovSummary(local, 7, '', {}, warnings);
}

describe('buildImprovSummary — 指型', () => {
    it('指型生效时正常显示', () => {
        const text = summary(result({
            key: 'C',
            scaleType: 'Major (Ionian)',
            fingering: 'La',
        }));

        expect(text).toContain('指型 La');
        expect(text).not.toContain('未套用');
        expect(text).toContain('5-8 品');
    });

    it('指型换算失败时标注回退来源', () => {
        const text = summary(result({
            key: 'C',
            scaleType: 'Pentatonic Major',
            fingering: 'Si',
        }));

        expect(text).toContain('指型 Si（未套用，已回退风格把位）');
        expect(text).toContain('风格把位');
    });

    it('练习窗口兜底时同样标注', () => {
        const text = summary(result({
            key: 'C',
            scaleType: 'Pentatonic Major',
            fingering: 'Si',
            practice: 'fretboard',
        }));

        expect(text).toContain('指型 Si（未套用，已回退练习窗口）');
    });

    it('显式把位与指型并存时按已套用显示', () => {
        const text = summary(result({
            key: 'C',
            scaleType: 'Major (Ionian)',
            fingering: 'La',
            fretRange: { min: 5, max: 8 },
        }));

        expect(text).toContain('指型 La');
        expect(text).not.toContain('未套用');
        expect(text).toContain('把位来源 显式');
    });

    it('没有指型时不出现指型字样', () => {
        const text = summary(result({ key: 'C', scaleType: 'Major (Ionian)' }));

        expect(text).not.toContain('指型');
    });
});

describe('buildImprovSummary — en', () => {
    it('英文摘要结构信息保留且无中文', () => {
        setLocale('en');
        const text = summary(result({
            key: 'C',
            scaleType: 'Major (Ionian)',
            fingering: 'La',
        }));

        expect(text).toContain('fingering La');
        expect(text).toContain('frets 5-8');
        expect(text).toContain('seed 7');
        expect(CJK.test(text)).toBe(false);
    });
});
