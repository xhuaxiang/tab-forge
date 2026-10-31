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
    FretRange,
    ImprovOptions,
    LocalDensity,
    LocalStyle,
    Progression,
    ResolvedImprovOptions,
    ScaleType,
} from '../../core/types/improv.ts';
import {
    LOCAL_DENSITIES,
    LOCAL_STYLES,
    SCALE_TYPES,
} from '../../core/types/improv.ts';
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
    formatChordSpec,
    generateLocalImprovisation,
    parseChordChartText,
    parseDescriptionChordChart,
    parseImprovDescription,
    parseProgressionText,
    progressionEquals,
} from '../../core/utils/improv/index.ts';
import { fillNumberSelect, fillSelectOptions } from './improvOptions.ts';

interface LocalInput {
    options: Partial<ImprovOptions>;
    warnings: string[];
}

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

    for (const id of ['localFretMin', 'localFretMax']) {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (!input) continue;
        input.min = String(config.playability.fretMin);
        input.max = String(config.playability.fretMax);
    }
}

function readLocalDescription(): string {
    return (document.getElementById('localImprovDescription') as HTMLTextAreaElement | null)?.value ?? '';
}

function readCustomProgression(): string {
    return (document.getElementById('localProgressionText') as HTMLInputElement | null)?.value.trim() ?? '';
}

function readNumberInput(id: string): number | null {
    const raw = (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
    if (raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function readFretRange(): FretRange | null {
    const min = readNumberInput('localFretMin');
    const max = readNumberInput('localFretMax');
    if (min === null && max === null) return null;
    return {
        min: min ?? LOCAL_IMPROV_CONFIG.playability.fretMin,
        max: max ?? LOCAL_IMPROV_CONFIG.playability.fretMax,
    };
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

function setInputValue(id: string, value: string): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input) input.value = value;
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

    if (options.fretRange) {
        setInputValue('localFretMin', String(options.fretRange.min));
        setInputValue('localFretMax', String(options.fretRange.max));
    }
}

/**
 * 读取控件 + 描述，合成生成选项。
 *
 * 和弦优先级：描述里的小节写法 > 描述里的标签/进行 > 自定义和弦输入 >
 * 下拉预设。每小节多个和弦时，统一展开成 `chordChart`；1 个和弦时保留
 * 旧的 `progression` 铺法（含最后一小节强制收尾）。
 */
function readLocalOptions(
    seed: number,
    described: Partial<ImprovOptions>,
    description: string,
): LocalInput {
    const warnings: string[] = [];
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

    const customText = readCustomProgression();
    const customSteps = customText === '' ? undefined : parseProgressionText(customText);
    const customBars = customText === '' ? null : parseChordChartText(customText);

    const descriptionBars = parseDescriptionChordChart(description);
    const selected = LOCAL_PROGRESSIONS.find(option =>
        option.value === (document.getElementById('localProgression') as HTMLSelectElement | null)?.value);

    if (customText !== '' && customSteps === null && customBars === null
        && !described.progression && !descriptionBars) {
        warnings.push('自定义和弦无法解析，已改用下拉进行');
    }

    const progression: Progression | undefined = described.progression
        ?? customBars?.flat()
        ?? customSteps
        ?? selected?.steps;

    // 描述里的进行优先级高于自定义输入；若描述已有进行，就不再让自定义
    // 小节表把实际和声覆盖掉。
    const chartBars = descriptionBars
        ?? (described.progression ? null : customBars);
    const chordsPerMeasure = readChordsPerMeasure();
    let chordChart: ChordEvent[] | undefined;
    if (chartBars) {
        chordChart = chordChartFromBars(chartBars, numMeasures, timeSignature);
    } else if (chordsPerMeasure > 1) {
        chordChart = buildChordChart(
            progression ?? [1], numMeasures, chordsPerMeasure, timeSignature,
        );
    }
    const fretRange = described.fretRange ?? readFretRange() ?? undefined;

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
        // 和弦与把位已经在本函数里合并过，避免 described 的旧值覆盖展开结果。
        progression,
        chordChart,
        fretRange,
        seed,
    };

    return { options, warnings };
}

/** 从实际和声计划反推展示用和弦，避免摘要显示未被采用的 progression */
function harmonyLabel(result: ReturnType<typeof generateLocalImprovisation>): string {
    const measures = result.harmony.map(measure =>
        measure.segments
            .map(segment => formatChordSpec(segment.chord))
            .join('/'));
    const shown = measures.slice(0, 4).join(' → ');
    return measures.length > 4 ? `${shown} → …` : shown;
}

function buildSummary(
    result: ReturnType<typeof generateLocalImprovisation>,
    seed: number,
    description: string,
    described: Partial<ImprovOptions>,
    warnings: string[],
): string {
    const sounding = result.notes.filter(note => !note.isRest).length;
    const descriptionNote = description === ''
        ? ''
        : Object.keys(described).length > 0
            ? ' · 描述已套用'
            : ' · 描述未命中可识别项';
    const chords = harmonyLabel(result);
    const maxSegments = result.harmony.reduce(
        (max, measure) => Math.max(max, measure.segments.length), 0,
    );
    const fretLabel = result.options.fretRange
        ? `${result.options.fretRange.min}-${result.options.fretRange.max} 品`
        : '风格把位';
    const warningText = warnings.length > 0
        ? ` · ⚠️ ${warnings.join('；')}`
        : '';

    return `✅ ${sounding} 个音符 / ${result.options.numMeasures} 小节 · `
        + `${result.options.key} ${result.options.scaleType} · `
        + `${result.options.style} · ${result.options.timeSignature} · ${fretLabel}`
        + ` · seed ${seed}`
        + (chords ? ` · 和弦 ${chords}` : '')
        + (maxSegments > 1 ? ` · ${maxSegments} 和弦/小节` : '')
        + descriptionNote
        + warningText;
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
        const input = readLocalOptions(seed, described, description);
        const warnings = [
            ...input.warnings,
            ...detectUnsupportedDescription(description),
        ];
        const result = generateLocalImprovisation(input.options);

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

        const summary = buildSummary(
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
