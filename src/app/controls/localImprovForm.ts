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
    ResolvedImprovOptions,
    ScaleType,
} from '../../core/types/improv.ts';
import {
    LOCAL_DENSITIES,
    LOCAL_STYLES,
    SCALE_TYPES,
} from '../../core/types/improv.ts';
import type { ImprovSelectOption } from '../../core/config.ts';
import { IMPROV_CONFIG, LOCAL_IMPROV_CONFIG } from '../../core/config.ts';
import {
    generateLocalImprovisation,
    parseImprovDescription,
} from '../../core/utils/improv/index.ts';
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

function readLocalDescription(): string {
    return (document.getElementById('localImprovDescription') as HTMLTextAreaElement | null)?.value ?? '';
}

function setSelectValue(id: string, value: string): void {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (select && Array.from(select.options).some(option => option.value === value)) {
        select.value = value;
    }
}

/** 把最终选项回写到控件，避免描述覆盖后下拉框还停在旧值 */
function syncLocalControls(options: ResolvedImprovOptions): void {
    setSelectValue('localNumMeasures', String(options.numMeasures));
    setSelectValue('localStyle', options.style);
    setSelectValue('localScaleType', options.scaleType);
    setSelectValue('localDensity', options.density);
    setSelectValue('keySelect', options.key);
    setSelectValue('timeSigSelect', options.timeSignature);
}

function readLocalOptions(
    seed: number,
    described: Partial<ImprovOptions>,
): Partial<ImprovOptions> {
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
        // 描述里写到的字段优先；没写到的沿用上面的控件/乐谱值。
        ...described,
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
        const description = readLocalDescription().trim();
        const described = parseImprovDescription(description);
        const result = generateLocalImprovisation(readLocalOptions(seed, described));

        // 描述可能覆盖拍号/调性；先落到 store，loadNotes 才会按新拍号切小节。
        scoreStore.beginBatch();
        try {
            if (scoreStore.score.timeSignature !== result.options.timeSignature) {
                scoreStore.setTimeSignature(result.options.timeSignature);
            }
            if (scoreStore.score.key !== result.options.key) {
                scoreStore.setKey(result.options.key);
            }
            scoreStore.loadNotes(result.notes, result.options.numMeasures);
        } finally {
            scoreStore.endBatch();
        }
        syncLocalControls(result.options);

        const sounding = result.notes.filter(note => !note.isRest).length;
        const descriptionNote = description === ''
            ? ''
            : Object.keys(described).length > 0
                ? ' · 描述已套用'
                : ' · 描述未命中可识别项';
        const summary = `✅ ${sounding} 个音符 / ${result.options.numMeasures} 小节 · `
            + `${result.options.key} ${result.options.scaleType} · `
            + `${result.options.style} · ${result.options.timeSignature} · seed ${seed}`
            + descriptionNote;
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
    $('localImprovBtn')?.addEventListener('click', handleLocalGenerate);
}
