/**
 * 本地即兴测试用的 ResolvedImprovOptions 工厂。
 *
 * 不是测试套件（文件名不以 .test.ts 结尾），只给同目录测试复用。
 */

import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type { ResolvedImprovOptions } from '../../../../core/types/improv.ts';
import { parseKey } from '../../../../core/utils/improv/pitch.ts';

export function makeOptions(
    overrides: Partial<ResolvedImprovOptions> = {},
): ResolvedImprovOptions {
    const defaults = LOCAL_IMPROV_CONFIG.defaults;
    const key = overrides.key ?? defaults.key;
    const parsed = parseKey(key);
    return {
        numMeasures: overrides.numMeasures ?? defaults.numMeasures,
        key,
        tonicPitchClass: overrides.tonicPitchClass ?? parsed?.tonicPitchClass ?? 0,
        scaleType: overrides.scaleType ?? defaults.scaleType,
        style: overrides.style ?? defaults.style,
        density: overrides.density ?? defaults.density,
        timeSignature: overrides.timeSignature ?? defaults.timeSignature,
        tuning: overrides.tuning ?? { ...defaults.tuning },
        progression: overrides.progression ?? [1],
        seed: overrides.seed ?? defaults.seed,
    };
}
