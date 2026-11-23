/**
 * improvLabels — 即兴下拉选项的按语言标签。
 *
 * IMPROV_CONFIG 的 label 是 prompt 资产（hint 会注入 prompt），不能拿来
 * 直接显示；这里用「机器值 → 文案 key」的穷尽映射，缺一个会编译期报错。
 * 纯映射，无 DOM，可被 node 测试直接 import。
 */

import type { ImprovSelectOption } from '../../core/config.ts';
import { LOCAL_PROGRESSIONS } from '../../core/config.ts';
import type { LocalDensity, LocalStyle, ScaleType } from '../../core/types/improv/index.ts';
import { LOCAL_DENSITIES, LOCAL_STYLES, SCALE_TYPES } from '../../core/types/improv/index.ts';
import { t, type MessageKey } from '../../core/i18n/index.ts';

const SCALE_KEYS: Record<ScaleType, MessageKey> = {
    'Major (Ionian)': 'improv.scale.major',
    'Natural Minor (Aeolian)': 'improv.scale.naturalMinor',
    'Harmonic Minor': 'improv.scale.harmonicMinor',
    'Pentatonic Major': 'improv.scale.pentatonicMajor',
    'Pentatonic Minor': 'improv.scale.pentatonicMinor',
    'Blues': 'improv.scale.blues',
    'Dorian': 'improv.scale.dorian',
    'Mixolydian': 'improv.scale.mixolydian',
};

const STYLE_KEYS: Record<LocalStyle, MessageKey> = {
    Jazz: 'improv.style.jazz',
    Blues: 'improv.style.blues',
    Rock: 'improv.style.rock',
    Folk: 'improv.style.folk',
    Classical: 'improv.style.classical',
};

const DENSITY_KEYS: Record<LocalDensity, MessageKey> = {
    '低': 'improv.density.low',
    '中': 'improv.density.medium',
    '高': 'improv.density.high',
};

export function buildScaleTypeOptions(): ImprovSelectOption[] {
    return SCALE_TYPES.map(value => ({ value, label: t(SCALE_KEYS[value]) }));
}

export function buildStyleOptions(): ImprovSelectOption[] {
    return LOCAL_STYLES.map(value => ({ value, label: t(STYLE_KEYS[value]) }));
}

export function buildDensityOptions(): ImprovSelectOption[] {
    return LOCAL_DENSITIES.map(value => ({ value, label: t(DENSITY_KEYS[value]) }));
}

/** 进行里的 `I–IV–V–I` 等是乐理符号，原样保留；只有「无（I 级）」需要翻译 */
export function buildProgressionOptions(): ImprovSelectOption[] {
    return LOCAL_PROGRESSIONS.map(option => ({
        value: option.value,
        label: option.value === 'I' ? t('improv.progression.rootOnly') : option.label,
    }));
}

export function buildChordsPerMeasureOptions(values: readonly number[]): ImprovSelectOption[] {
    return values.map(value => ({
        value: String(value),
        label: value === 1
            ? t('improv.chordsPerMeasure.whole')
            : t('improv.chordsPerMeasure.split', { value }),
    }));
}
