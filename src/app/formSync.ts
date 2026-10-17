/**
 * formSync — 把默认值同步到页面控件
 */

import { TUNING_PRESETS } from '../core/types/index.ts';
import type { Tuning } from '../core/types/index.ts';
import { SCORE_DEFAULTS } from '../core/config.ts';

/** 把 SCORE_DEFAULTS 同步到页面控件（调性/BPM/调弦/预设），单一来源 */
export function syncScoreDefaultsToUI(): void {
    const { key, bpm, tuning } = SCORE_DEFAULTS;

    const keySel = document.getElementById('keySelect') as HTMLSelectElement | null;
    if (keySel) keySel.value = key;

    const bpmInput = document.getElementById('bpmInput') as HTMLInputElement | null;
    if (bpmInput) bpmInput.value = String(bpm);

    for (let i = 1; i <= 6; i++) {
        const input = document.getElementById(`tuning${i}`) as HTMLInputElement | null;
        if (input) input.value = tuning[`string${i}` as keyof Tuning];
    }

    const presetSel = document.getElementById('tuningPreset') as HTMLSelectElement | null;
    if (presetSel) {
        const match = Object.entries(TUNING_PRESETS).find(([, t]) => isTuningEqual(t, tuning));
        presetSel.value = match ? match[0] : 'standard';
    }
}

function isTuningEqual(a: Tuning, b: Tuning): boolean {
    return a.string1 === b.string1 && a.string2 === b.string2 && a.string3 === b.string3
        && a.string4 === b.string4 && a.string5 === b.string5 && a.string6 === b.string6;
}
