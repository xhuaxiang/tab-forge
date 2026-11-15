/**
 * fingering — 标准五型指法 → 把位窗口（纯函数）。
 *
 * 五型以「关系大调」级数命名（国内通行口径）：Mi=3、Sol=5、La=6、Si=7、Re=2。
 * 锚点是 **6 弦上该级音的最低可用品位**，窗口固定 `windowWidth` 品：
 * C 大调 La 型 → 5-8 品。
 *
 * 指型只负责圈定把位，实际音高仍由所选音阶生成；五声/Blues 没有 Si 级，
 * 对应的 Si 型会返回 null，由调用方回退到风格把位。
 */

import type { Tuning } from '../../types/index.ts';
import type {
    FingeringPattern,
    FretRange,
    PlayabilityRules,
    ScaleType,
} from '../../types/improv/index.ts';
import { openStringMidis, scalePitchClasses } from './pitch.ts';

/** 五型对应的关系大调级数 */
const PATTERN_DEGREE: Record<FingeringPattern, 2 | 3 | 5 | 6 | 7> = {
    Mi: 3,
    Sol: 5,
    La: 6,
    Si: 7,
    Re: 2,
};

/** 大调级数 → 相对主音的半音数 */
const MAJOR_DEGREE_SEMITONES: Record<number, number> = {
    1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11,
};

/** 各音阶的关系大调主音偏移（相对自身主音，模 12） */
const PARENT_MAJOR_OFFSET: Record<ScaleType, number> = {
    'Major (Ionian)': 0,
    'Pentatonic Major': 0,
    'Dorian': 10,
    'Mixolydian': 5,
    'Natural Minor (Aeolian)': 3,
    'Harmonic Minor': 3,
    'Pentatonic Minor': 3,
    'Blues': 3,
};

function mod12(value: number): number {
    return ((value % 12) + 12) % 12;
}

/**
 * 把标准五型换算成把位窗口。
 *
 * @param pattern          Mi / Sol / La / Si / Re
 * @param tonicPitchClass  主音 pitch class（0-11）
 * @param scaleType        音阶；决定关系大调主音
 * @param tuning           调弦；锚品随 6 弦空弦移动（Drop D 的 La = 7-10）
 * @param playability      品位范围
 * @param windowWidth      窗口宽度（品），通常 4
 * @returns 窗口；音阶缺该级音、调弦非法或窗口越界时返回 null
 */
export function fingeringFretRange(
    pattern: FingeringPattern,
    tonicPitchClass: number,
    scaleType: ScaleType,
    tuning: Tuning,
    playability: PlayabilityRules,
    windowWidth: number,
): FretRange | null {
    if (!Number.isFinite(windowWidth) || windowWidth < 1) return null;

    const degree = PATTERN_DEGREE[pattern];
    const parentPc = mod12(tonicPitchClass + PARENT_MAJOR_OFFSET[scaleType]);
    const anchorPc = mod12(parentPc + MAJOR_DEGREE_SEMITONES[degree]);

    // 五声 / Blues 缺 Si 级：指型名对应的音不在音阶里，不能硬套
    if (!scalePitchClasses(tonicPitchClass, scaleType).includes(anchorPc)) {
        return null;
    }

    let open6: number;
    try {
        open6 = openStringMidis(tuning)[6];
    } catch {
        return null;
    }
    if (open6 === undefined) return null;

    const lowest = Math.max(playability.fretMin, 0);
    const highest = playability.fretMax - (windowWidth - 1);
    if (highest < lowest) return null;

    // 取最低可用锚品：fretMin > 0 时自然落到该音的下一个八度
    for (let fret = lowest; fret <= highest; fret++) {
        if (mod12(open6 + fret) === anchorPc) {
            return { min: fret, max: fret + windowWidth - 1 };
        }
    }
    return null;
}
