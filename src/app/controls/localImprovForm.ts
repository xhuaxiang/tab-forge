/**
 * localImprovForm — 本地即兴生成面板的事件绑定。
 *
 * 只做三件事：把 config 灌进下拉、读当前乐谱元数据、把生成结果交给
 * scoreStore.loadNotes。生成算法本身全在 core/utils/improv 里。
 */

import { $, setStatus } from '../dom.ts';
import { scoreStore } from '../../core/stores/scoreStore.ts';
import type {
    ChordEvent,
    ImprovOptions,
    LocalDensity,
    LocalStyle,
    Progression,
    ResolvedImprovOptions,
    ScaleType,
} from '../../core/types/improv/index.ts';
import {
    LOCAL_DENSITIES,
    LOCAL_STYLES,
    SCALE_TYPES,
} from '../../core/types/improv/index.ts';
import type { ImprovSelectOption } from '../../core/config.ts';
import {
    IMPROV_CONFIG,
    LOCAL_IMPROV_CONFIG,
    LOCAL_PROGRESSIONS,
} from '../../core/config.ts';
import {
    buildChordChart,
    chordChartFromBars,
    detectUnsupportedDescription,
    generateLocalImprovisation,
    parseDescriptionChordChart,
    parseImprovDescription,
    progressionEquals,
} from '../../core/utils/improv/index.ts';
import { buildImprovSummary } from './improvSummary.ts';
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
    fillSelectOptions(
        'localProgression',
        LOCAL_PROGRESSIONS.map(option => ({
            value: option.value,
            label: option.label,
        })),
        LOCAL_PROGRESSIONS[0].value,
    );
    fillSelectOptions(
        'localChordsPerMeasure',
        config.chordsPerMeasure.options.map(value => ({
            value: String(value),
            label: value === 1 ? '1（整小节）' : `${value}（等分）`,
        })),
        String(config.chordsPerMeasure.default),
    );
}

function readLocalDescription(): string {
    return (document.getElementById('localImprovDescription') as HTMLTextAreaElement | null)?.value ?? '';
}

function readChordsPerMeasure(): number {
    const value = Number(
        (document.getElementById('localChordsPerMeasure') as HTMLSelectElement | null)?.value,
    );
    return LOCAL_IMPROV_CONFIG.chordsPerMeasure.options.includes(value)
        ? value
        : LOCAL_IMPROV_CONFIG.chordsPerMeasure.default;
}

function setSelectValue(id: string, value: string): void {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (select && Array.from(select.options).some(option => option.value === value)) {
        select.value = value;
    }
}

function matchProgression(
    steps: ResolvedImprovOptions['progression'],
): (typeof LOCAL_PROGRESSIONS)[number] | undefined {
    return LOCAL_PROGRESSIONS.find(option => progressionEquals(option.steps, steps));
}

/** 把最终选项回写到控件，避免描述覆盖后下拉框还停在旧值 */
function syncLocalControls(options: ResolvedImprovOptions): void {
    setSelectValue('localNumMeasures', String(options.numMeasures));
    setSelectValue('localStyle', options.style);
    setSelectValue('localScaleType', options.scaleType);
    setSelectValue('localDensity', options.density);
    setSelectValue('keySelect', options.key);
    setSelectValue('timeSigSelect', options.timeSignature);

    const progressionValue = matchProgression(options.progression)?.value;
    if (progressionValue) setSelectValue('localProgression', progressionValue);
}

/**
 * 读取控件 + 描述，合成生成选项。
 *
 * 和弦优先级：描述里的小节写法 > 描述里的标签/进行 > 下拉预设。
 * 每小节多个和弦时，统一展开成 `chordChart`；1 个和弦时保留旧的
 * `progression` 铺法（含最后一小节强制收尾）。
 */
function readLocalOptions(
    seed: number,
    described: Partial<ImprovOptions>,
    description: string,
): Partial<ImprovOptions> {
    const config = LOCAL_IMPROV_CONFIG;
    const numValue = (document.getElementById('localNumMeasures') as HTMLSelectElement | null)?.value;
    const parsed = numValue === undefined || numValue === '' ? NaN : Number(numValue);
    const numMeasures = described.numMeasures
        ?? (Number.isFinite(parsed) ? parsed : config.defaults.numMeasures);
    const scoreTimeSignature = scoreStore.score.timeSignature;
    const timeSignature = described.timeSignature
        ?? (config.timeSignatures.includes(scoreTimeSignature)
            ? scoreTimeSignature
            : config.defaults.timeSignature);

    const descriptionBars = parseDescriptionChordChart(description);
    const selected = LOCAL_PROGRESSIONS.find(option =>
        option.value === (document.getElementById('localProgression') as HTMLSelectElement | null)?.value);

    // 和弦只来自描述或下拉预设；描述里的小节写法优先。
    const progression: Progression | undefined = described.progression ?? selected?.steps;
    const chartBars = descriptionBars;
    const chordsPerMeasure = readChordsPerMeasure();
    let chordChart: ChordEvent[] | undefined;
    if (chartBars) {
        chordChart = chordChartFromBars(chartBars, numMeasures, timeSignature);
    } else if (chordsPerMeasure > 1) {
        chordChart = buildChordChart(
            progression ?? [1], numMeasures, chordsPerMeasure, timeSignature,
        );
    }

    const options: Partial<ImprovOptions> = {
        numMeasures,
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
        timeSignature,
        tuning: { ...scoreStore.score.tuning },
        // 描述里写到的字段优先；没写到的沿用上面的控件/乐谱值。
        ...described,
        // 和弦已经在本函数里合并过，避免 described 的旧值覆盖展开结果。
        progression,
        chordChart,
        seed,
    };

    return options;
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
        const options = readLocalOptions(seed, described, description);
        const warnings = detectUnsupportedDescription(description);
        const result = generateLocalImprovisation(options);

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

        const summary = buildImprovSummary(
            result, seed, description, described, warnings,
        );
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
