/**
 * improvLabels — 下拉文案的语言映射。
 *
 * zh 必须与 IMPROV_CONFIG / LOCAL_PROGRESSIONS 的现有 label 逐字一致
 * （默认语言下界面与改造前相同）；en 不得残留中文。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../core/i18n/index.ts';
import {
    IMPROV_CONFIG,
    LOCAL_IMPROV_CONFIG,
    LOCAL_PROGRESSIONS,
} from '../../../core/config.ts';
import {
    buildChordsPerMeasureOptions,
    buildDensityOptions,
    buildProgressionOptions,
    buildScaleTypeOptions,
    buildStyleOptions,
} from '../../../app/controls/improvLabels.ts';

afterEach(() => setLocale('zh-CN'));

const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

function labels(options: ReadonlyArray<{ label: string }>): string[] {
    return options.map(option => option.label);
}

describe('improvLabels — zh 与配置逐字一致', () => {
    it('音阶 / 风格 / 密度', () => {
        expect(labels(buildScaleTypeOptions())).toEqual(labels(IMPROV_CONFIG.scaleTypes));
        expect(labels(buildStyleOptions())).toEqual(labels(IMPROV_CONFIG.styles));
        expect(labels(buildDensityOptions())).toEqual(labels(IMPROV_CONFIG.densities));
    });

    it('和弦进行', () => {
        expect(labels(buildProgressionOptions())).toEqual(LOCAL_PROGRESSIONS.map(o => o.label));
    });

    it('每小节和弦数', () => {
        expect(labels(buildChordsPerMeasureOptions(LOCAL_IMPROV_CONFIG.chordsPerMeasure.options)))
            .toEqual(['1（整小节）', '2（等分）', '4（等分）']);
    });
});

describe('improvLabels — en 无中文', () => {
    it('所有选项均为英文', () => {
        setLocale('en');
        const all = [
            ...buildScaleTypeOptions(),
            ...buildStyleOptions(),
            ...buildDensityOptions(),
            ...buildProgressionOptions(),
            ...buildChordsPerMeasureOptions(LOCAL_IMPROV_CONFIG.chordsPerMeasure.options),
        ];
        for (const option of all) {
            expect(CJK.test(option.label), `${option.value}: ${option.label}`).toBe(false);
            expect(option.label).not.toBe('');
        }
    });
});
