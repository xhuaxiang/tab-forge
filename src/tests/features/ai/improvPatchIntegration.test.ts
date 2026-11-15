/**
 * 两段式 AI 即兴的端到端拼装：本地生成 → 拍位序列化 → 假 AI JSON →
 * 解析 → 应用 → validateNotes。
 *
 * 不使用网络：patch 文本手工构造，模拟 AI 按拍位表返回补丁。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../core/config.ts';
import {
    applyPerformancePatches,
    generateLocalImprovisation,
    indexImprovSlots,
    serializeImprovSlots,
} from '../../../core/utils/improv/index.ts';
import { validateNotes } from '../../../core/utils/improv/validate.ts';
import { parseImprovPatchesResponse } from '../../../features/ai/improvPatchParser.ts';

const PLAYABILITY = LOCAL_IMPROV_CONFIG.playability;

describe('本地底稿 + 假 AI 补丁', () => {
    const local = generateLocalImprovisation({
        key: 'C',
        scaleType: 'Major (Ionian)',
        style: 'Folk',
        density: '中',
        numMeasures: 2,
        timeSignature: '4/4',
        seed: 7,
    });

    it('补丁经解析、应用后通过 validateNotes，且不修改底稿', () => {
        const slots = serializeImprovSlots(local.notes, local.options);
        const target = slots.find(slot =>
            !slot.rest
            && slot.notes?.length === 1
            && slot.notes[0].fret > 0
            && slot.duration >= PLAYABILITY.minHarmonicDuration);
        expect(target).toBeDefined();

        // 模拟 AI 按拍位表定位：加力度并改成人工泛音
        const raw = {
            patches: [{
                measureIndex: target!.measureIndex,
                slotIndex: target!.slotIndex,
                dynamics: 'accent',
                harmonic: 'artificial',
                harmonicFret: 12,
                targetFret: target!.notes![0].fret,
            }],
        };
        const parsed = parseImprovPatchesResponse(JSON.stringify(raw), 128);
        expect(parsed.error).toBeUndefined();
        expect(parsed.patches).toHaveLength(1);
        expect(parsed.warnings.some(warning => warning.includes('targetFret')))
            .toBe(true);

        const applied = applyPerformancePatches(
            local.notes,
            parsed.patches,
            local.options,
            PLAYABILITY,
            local.harmony,
            local.phrases,
            local.maxLeapSemitones,
            128,
        );

        expect(applied.reverted).toBe(false);
        expect(applied.applied).toBe(1);
        expect(applied.dropped).toEqual([]);

        const slot = indexImprovSlots(local.notes, local.options).slots.find(
            candidate => candidate.measureIndex === target!.measureIndex
                && candidate.slotIndex === target!.slotIndex,
        );
        expect(slot).toBeDefined();

        const patched = applied.notes[slot!.noteStart];
        expect(patched.dynamics).toBe('accent');
        expect(patched.harmonic).toBe('artificial');
        expect(patched.harmonicFret).toBe(12);
        expect(patched.string).toBe(local.notes[slot!.noteStart].string);
        expect(patched.fret).toBe(local.notes[slot!.noteStart].fret);
        expect(patched.duration).toBe(local.notes[slot!.noteStart].duration);

        // 输入底稿保持不变
        expect(local.notes[slot!.noteStart].harmonic).toBeUndefined();
        expect(local.notes[slot!.noteStart].dynamics).not.toBe('accent');

        expect(validateNotes(
            applied.notes,
            local.options,
            PLAYABILITY,
            local.maxLeapSemitones,
            local.harmony,
            local.phrases,
        )).toEqual([]);
    });

    it('越界拍位补丁被丢弃，底稿仍合法', () => {
        const parsed = parseImprovPatchesResponse(JSON.stringify({
            patches: [{
                measureIndex: 99,
                slotIndex: 0,
                dynamics: 'soft',
            }],
        }), 128);

        const applied = applyPerformancePatches(
            local.notes,
            parsed.patches,
            local.options,
            PLAYABILITY,
            local.harmony,
            local.phrases,
            local.maxLeapSemitones,
            128,
        );

        expect(applied.applied).toBe(0);
        expect(applied.dropped).toHaveLength(1);
        expect(applied.reverted).toBe(false);
        expect(validateNotes(
            applied.notes,
            local.options,
            PLAYABILITY,
            local.maxLeapSemitones,
            local.harmony,
            local.phrases,
        )).toEqual([]);
    });
});
