/**
 * localImprovForm — 本地即兴生成面板的事件绑定。
 *
 * 只做三件事：把 config 灌进下拉、读当前乐谱元数据、把生成结果交给
 * scoreStore.loadNotes。生成算法本身全在 core/utils/improv 里。
 */

import { $, setStatus } from '../dom.ts';
import { scoreStore } from '../../core/stores/scoreStore.ts';
import type {
    ImprovOptions,
    LocalDensity,
    LocalStyle,
    ScaleType,
} from '../../core/types/improv.ts';
import {
    LOCAL_DENSITIES,
    LOCAL_STYLES,
    SCALE_TYPES,
} from '../../core/types/improv.ts';
import type { ImprovSelectOption } from '../../core/config.ts';
import { IMPROV_CONFIG, LOCAL_IMPROV_CONFIG } from '../../core/config.ts';
import { generateLocalImprovisation } from '../../core/utils/improv/index.ts';
import { fillNumberSelect, fillSelectOptions } from './improvOptions.ts';

function readOption<T extends string>(
    id: string,
    options: readonly T[],
    fallback: T,
): T {
    const value = (document.getElementById(id) as HTMLSelectElement | null)?.value;
    return value !== undefined && (options as readonly string[]).includes(value)
        ? value as T
        : fallback;
}

/** 用本地值顺序去取 AI 文案表里的 label，避免维护第二份中英文映射 */
function labelOptions<T extends string>(
    values: readonly T[],
    source: readonly ImprovSelectOption[],
): ImprovSelectOption[] {
    return values.map(value => {
        const found = source.find(option => option.value === value);
        return found ? { value, label: found.label } : { value, label: value };
    });
}

function initLocalImprovOptions(): void {
    const config = LOCAL_IMPROV_CONFIG;
    fillNumberSelect(
        'localNumMeasures',
        config.numMeasures.options,
        config.numMeasures.default,
    );
    fillSelectOptions(
        'localScaleType',
        labelOptions(SCALE_TYPES, IMPROV_CONFIG.scaleTypes),
        config.defaults.scaleType,
    );
    fillSelectOptions(
        'localStyle',
        labelOptions(LOCAL_STYLES, IMPROV_CONFIG.styles),
        config.defaults.style,
    );
    fillSelectOptions(
        'localDensity',
        labelOptions(LOCAL_DENSITIES, IMPROV_CONFIG.densities),
        config.defaults.density,
    );
}

function readLocalOptions(seed: number): Partial<ImprovOptions> {
    const numValue = (document.getElementById('localNumMeasures') as HTMLSelectElement | null)?.value;
    const parsed = numValue === undefined || numValue === '' ? NaN : Number(numValue);
    const config = LOCAL_IMPROV_CONFIG;

    return {
        numMeasures: Number.isFinite(parsed) ? parsed : undefined,
        key: scoreStore.score.key || undefined,
        scaleType: readOption<ScaleType>(
            'localScaleType', SCALE_TYPES, config.defaults.scaleType,
        ),
        style: readOption<LocalStyle>(
            'localStyle', LOCAL_STYLES, config.defaults.style,
        ),
        density: readOption<LocalDensity>(
            'localDensity', LOCAL_DENSITIES, config.defaults.density,
        ),
        timeSignature: scoreStore.score.timeSignature || undefined,
        tuning: { ...scoreStore.score.tuning },
        seed,
    };
}

function handleLocalGenerate(): void {
    const statusEl = document.getElementById('localImprovStatus');
    const button = document.getElementById('localImprovBtn') as HTMLButtonElement | null;
    // 每次点「生成」都要有新乐句；种子只在本次生成内保证可复现。
    const seed = Math.floor(Math.random() * 0x100000000) >>> 0;

    if (button) {
        button.disabled = true;
        button.textContent = '⏳ 生成中...';
    }

    try {
        const result = generateLocalImprovisation(readLocalOptions(seed));
        scoreStore.loadNotes(result.notes, result.options.numMeasures);
        const sounding = result.notes.filter(note => !note.isRest).length;
        const summary = `✅ ${sounding} 个音符 / ${result.options.numMeasures} 小节 · `
            + `${result.options.key} ${result.options.scaleType} · `
            + `${result.options.style} · ${result.options.timeSignature} · seed ${seed}`;
        setStatus(`✅ 本地即兴已生成（${result.options.style}）`, 'success');
        if (statusEl) statusEl.textContent = summary;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`本地即兴生成失败: ${message}`, 'error');
        if (statusEl) statusEl.textContent = `❌ ${message}`;
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = '🎸 生成即兴谱';
        }
    }
}

export function initLocalImprovForm(): void {
    initLocalImprovOptions();

    $('localImprovTopBtn')?.addEventListener('click', () => {
        const panel = document.getElementById('localImprovPanel') as HTMLDetailsElement | null;
        if (panel) {
            panel.open = true;
            panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    $('localImprovBtn')?.addEventListener('click', handleLocalGenerate);
}
