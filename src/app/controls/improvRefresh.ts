/**
 * improvRefresh — 重建即兴面板下拉（AI / 本地）。
 *
 * 语言切换时只重建选项文案，保留用户当前选择；不重绑事件——
 * 选项点击走 select 自身，fillSelectOptions 重写 innerHTML 不影响 change 监听。
 */

import { IMPROV_CONFIG, LOCAL_IMPROV_CONFIG, LOCAL_PROGRESSIONS } from '../../core/config.ts';
import { fillNumberSelect, fillSelectOptions } from './improvOptions.ts';
import {
    buildChordsPerMeasureOptions,
    buildDensityOptions,
    buildProgressionOptions,
    buildScaleTypeOptions,
    buildStyleOptions,
} from './improvLabels.ts';

export function refreshAiImprovOptions(): void {
    fillNumberSelect(
        'aiNumMeasures',
        IMPROV_CONFIG.numMeasures.options,
        IMPROV_CONFIG.numMeasures.default,
        { preferCurrent: true },
    );
    fillSelectOptions('aiScaleType', buildScaleTypeOptions(), IMPROV_CONFIG.scaleTypes[0].value, { preferCurrent: true });
    fillSelectOptions('aiStyle', buildStyleOptions(), IMPROV_CONFIG.styles[0].value, { preferCurrent: true });
    fillSelectOptions('aiDensity', buildDensityOptions(), IMPROV_CONFIG.densities[1].value, { preferCurrent: true });
}

export function refreshLocalImprovOptions(): void {
    const config = LOCAL_IMPROV_CONFIG;
    fillNumberSelect(
        'localNumMeasures',
        config.numMeasures.options,
        config.numMeasures.default,
        { preferCurrent: true },
    );
    fillSelectOptions('localScaleType', buildScaleTypeOptions(), config.defaults.scaleType, { preferCurrent: true });
    fillSelectOptions('localStyle', buildStyleOptions(), config.defaults.style, { preferCurrent: true });
    fillSelectOptions('localDensity', buildDensityOptions(), config.defaults.density, { preferCurrent: true });
    fillSelectOptions('localProgression', buildProgressionOptions(), LOCAL_PROGRESSIONS[0].value, { preferCurrent: true });
    fillSelectOptions(
        'localChordsPerMeasure',
        buildChordsPerMeasureOptions(config.chordsPerMeasure.options),
        String(config.chordsPerMeasure.default),
        { preferCurrent: true },
    );
}

export function refreshImprovOptions(): void {
    refreshAiImprovOptions();
    refreshLocalImprovOptions();
}
