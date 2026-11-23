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
import { LOCAL_IMPROV_CONFIG, LOCAL_PROGRESSIONS } from '../../core/config.ts';
import {
    buildChordChart,
    chordChartFromBars,
    detectUnsupportedDescription,
    generateLocalImprovisation,
    parseDescriptionChordChart,
    parseImprovDescription,
    progressionEquals,
} from '../../core/utils/improv/index.ts';
import { t } from '../../core/i18n/index.ts';
import { trackImprovGenerated } from '../analytics.ts';
import { buildImprovSummary } from './improvSummary.ts';
import { refreshLocalImprovOptions } from './improvRefresh.ts';
import { clearLocalSummarySnapshot, setLocalSummarySnapshot } from './improvSummaryState.ts';

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
        button.textContent = t('improv.generating');
    }

    // 新一轮生成开始即丢弃旧快照：失败时切语言不能把错误条覆盖成上次摘要
    clearLocalSummarySnapshot();
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
        setLocalSummarySnapshot({ result, seed, description, described });
        setStatus(t('improv.localDone', { style: result.options.style }), 'success');
        trackImprovGenerated();
        if (statusEl) statusEl.textContent = summary;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(t('improv.localFailedWith', { message }), 'error');
        if (statusEl) statusEl.textContent = t('improv.errorPrefix', { message });
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = t('improv.generateLocal');
        }
    }
}

export function initLocalImprovForm(): void {
    refreshLocalImprovOptions();
    $('localImprovBtn')?.addEventListener('click', handleLocalGenerate);
}
