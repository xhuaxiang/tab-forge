/**
 * improvSummary — 本地即兴生成结果的状态栏摘要（AI / 本地面板共用）。
 *
 * 从 localImprovForm 抽出：两处显示同一份数据，避免各自漂移。
 * 新增的指型 / 练习 / 把位来源只在有值时追加，未使用这些选项时输出
 * 与旧版本完全一致。
 */

import type {
    ImprovOptions,
    LocalImprovResult,
    PracticeFocus,
} from '../../core/types/improv/index.ts';
import { formatChordSpec } from '../../core/utils/improv/index.ts';

const PRACTICE_LABELS: Record<PracticeFocus, string> = {
    none: '',
    fretboard: '熟悉指板',
    ear: '找音感',
    technique: '练技法',
    warmup: '热身',
};

const FRET_SOURCE_LABELS: Record<LocalImprovResult['options']['fretRangeSource'], string> = {
    explicit: '显式',
    fingering: '指型',
    practice: '练习锁定',
    style: '风格',
};

/** 从实际和声计划反推展示用和弦，避免摘要显示未被采用的 progression */
export function harmonyLabel(result: LocalImprovResult): string {
    const measures = result.harmony.map(measure =>
        measure.segments
            .map(segment => formatChordSpec(segment.chord))
            .join('/'));
    const shown = measures.slice(0, 4).join(' → ');
    return measures.length > 4 ? `${shown} → …` : shown;
}

/**
 * @param described 本地关键词解析结果（用于标注「描述已套用 / 未命中」）
 * @param warnings  额外提示（不支持项等）
 */
export function buildImprovSummary(
    result: LocalImprovResult,
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
    const { options } = result;
    const fretLabel = options.fretRange
        ? `${options.fretRange.min}-${options.fretRange.max} 品`
        : '风格把位';
    const fingeringText = !options.fingering
        ? ''
        : options.fretRangeSource === 'fingering' || options.fretRangeSource === 'explicit'
            ? ` · 指型 ${options.fingering}`
            : ` · 指型 ${options.fingering}（未套用，已回退`
                + `${options.fretRangeSource === 'practice' ? '练习窗口' : '风格把位'}）`;
    const practiceText = options.practice !== 'none'
        ? ` · 练习 ${PRACTICE_LABELS[options.practice]}`
        : '';
    const sourceText = options.fretRangeSource !== 'style' && options.fretRange
        ? ` · 把位来源 ${FRET_SOURCE_LABELS[options.fretRangeSource]}`
        : '';
    const warningText = warnings.length > 0
        ? ` · ⚠️ ${warnings.join('；')}`
        : '';

    return `✅ ${sounding} 个音符 / ${options.numMeasures} 小节 · `
        + `${options.key} ${options.scaleType} · `
        + `${options.style} · ${options.timeSignature} · ${fretLabel}`
        + fingeringText + practiceText + sourceText
        + ` · seed ${seed}`
        + (chords ? ` · 和弦 ${chords}` : '')
        + (maxSegments > 1 ? ` · ${maxSegments} 和弦/小节` : '')
        + descriptionNote
        + warningText;
}
