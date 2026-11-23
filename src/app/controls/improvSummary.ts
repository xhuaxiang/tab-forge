/**
 * improvSummary — 本地即兴生成结果的状态栏摘要（AI / 本地面板共用）。
 *
 * 从 localImprovForm 抽出：两处显示同一份数据，避免各自漂移。
 * 新增的指型 / 练习 / 把位来源只在有值时追加，未使用这些选项时输出
 * 与旧版本完全一致。文案 key 在调用时解析，切换语言后重建即为新语言。
 */

import type {
    ImprovOptions,
    LocalImprovResult,
    PracticeFocus,
} from '../../core/types/improv/index.ts';
import { formatChordSpec } from '../../core/utils/improv/index.ts';
import { t, type MessageKey } from '../../core/i18n/index.ts';

const PRACTICE_KEYS: Record<PracticeFocus, MessageKey | null> = {
    none: null,
    fretboard: 'improv.practice.fretboard',
    ear: 'improv.practice.ear',
    technique: 'improv.practice.technique',
    warmup: 'improv.practice.warmup',
};

const FRET_SOURCE_KEYS: Record<LocalImprovResult['options']['fretRangeSource'], MessageKey> = {
    explicit: 'improv.fretSource.explicit',
    fingering: 'improv.fretSource.fingering',
    practice: 'improv.fretSource.practice',
    style: 'improv.fretSource.style',
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
            ? t('improv.summary.descriptionApplied')
            : t('improv.summary.descriptionMissed');
    const chords = harmonyLabel(result);
    const maxSegments = result.harmony.reduce(
        (max, measure) => Math.max(max, measure.segments.length), 0,
    );
    const { options } = result;
    const fretLabel = options.fretRange
        ? t('improv.summary.fretRange', { min: options.fretRange.min, max: options.fretRange.max })
        : t('improv.summary.stylePosition');
    const fallbackLabel = options.fretRangeSource === 'practice'
        ? t('improv.summary.fallbackPractice')
        : t('improv.summary.fallbackStyle');
    const fingeringText = !options.fingering
        ? ''
        : options.fretRangeSource === 'fingering' || options.fretRangeSource === 'explicit'
            ? t('improv.summary.fingeringApplied', { fingering: options.fingering })
            : t('improv.summary.fingeringFallback', {
                fingering: options.fingering,
                source: fallbackLabel,
            });
    const practiceKey = PRACTICE_KEYS[options.practice];
    const practiceText = practiceKey
        ? t('improv.summary.practice', { focus: t(practiceKey) })
        : '';
    const sourceText = options.fretRangeSource !== 'style' && options.fretRange
        ? t('improv.summary.fretSource', { source: t(FRET_SOURCE_KEYS[options.fretRangeSource]) })
        : '';
    const warningText = warnings.length > 0
        ? t('improv.summary.warnings', {
            warnings: warnings.join(t('improv.summary.warningSeparator')),
        })
        : '';

    return t('improv.summary.headline', {
        notes: sounding,
        measures: options.numMeasures,
        key: options.key,
        scaleType: options.scaleType,
        style: options.style,
        timeSignature: options.timeSignature,
        fret: fretLabel,
    })
        + fingeringText + practiceText + sourceText
        + t('improv.summary.seed', { seed })
        + (chords ? t('improv.summary.chords', { chords }) : '')
        + (maxSegments > 1 ? t('improv.summary.chordsPerMeasure', { count: maxSegments }) : '')
        + descriptionNote
        + warningText;
}
