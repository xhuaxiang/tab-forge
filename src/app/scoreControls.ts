/**
 * scoreControls — 调弦 / BPM / 调性 / 拍号
 */

import { TUNING_PRESETS } from '../core/types/index.ts';
import { $, setStatus } from './dom.ts';
import { scoreStore } from '../core/stores/scoreStore.ts';
import { SCORE_DEFAULTS } from '../core/config.ts';

export function initScoreControls(): void {
    // --- 调弦 ---
    $('tuningPreset')?.addEventListener('change', (e) => {
        const sel = e.target as HTMLSelectElement;
        const preset = TUNING_PRESETS[sel.value];
        if (!preset) return;
        scoreStore.setTuning(preset);
        for (let i = 1; i <= 6; i++) {
            const inp = $(`tuning${i}`) as HTMLInputElement;
            if (inp) inp.value = preset[`string${i}` as keyof typeof preset];
        }
        setStatus(`调弦: ${sel.value}`, 'success');
    });

    for (let i = 1; i <= 6; i++) {
        $(`tuning${i}`)?.addEventListener('change', (e) => {
            const inp = e.target as HTMLInputElement;
            scoreStore.setStringTuning(i, inp.value);
                setStatus(`第${i}弦 = ${inp.value}`, 'info');
        });
    }

    // --- BPM ---
    const bpmInput = $('bpmInput') as HTMLInputElement;
    const bpmInc = $('bpmIncBtn');
    const bpmDec = $('bpmDecBtn');

    bpmInput?.addEventListener('change', () => {
        const v = parseInt(bpmInput.value, 10);
        scoreStore.setBpm(isNaN(v) ? SCORE_DEFAULTS.bpm : v);
        bpmInput.value = String(scoreStore.score.bpm);
        setStatus(`BPM: ${scoreStore.score.bpm}`, 'info');
    });
    bpmInc?.addEventListener('click', () => {
        scoreStore.setBpm(scoreStore.score.bpm + 5);
        bpmInput.value = String(scoreStore.score.bpm);
        setStatus(`BPM: ${scoreStore.score.bpm}`, 'info');
    });
    bpmDec?.addEventListener('click', () => {
        scoreStore.setBpm(scoreStore.score.bpm - 5);
        bpmInput.value = String(scoreStore.score.bpm);
        setStatus(`BPM: ${scoreStore.score.bpm}`, 'info');
    });

    // --- 调性 ---
    const keySelect = $('keySelect') as HTMLSelectElement;
    if (keySelect) {
        keySelect.value = scoreStore.score.key || 'C';
        keySelect.addEventListener('change', () => {
            scoreStore.setKey(keySelect.value);
                setStatus(`调性: ${keySelect.value}`, 'info');
        });
    }

    // --- 全局拍号 ---
    const timeSigSelect = $('timeSigSelect') as HTMLSelectElement;
    if (timeSigSelect) {
        timeSigSelect.value = scoreStore.score.timeSignature;
        timeSigSelect.addEventListener('change', () => {
            scoreStore.setTimeSignature(timeSigSelect.value);
                setStatus(`拍号: ${timeSigSelect.value}`, 'info');
        });
    }
}
