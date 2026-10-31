/**
 * phrase — 乐句计划（纯函数）。
 *
 * 解决「每小节重新抽一次动机」的问题：先生成一条跨小节的级数步序列，
 * 再让后续乐句按 statement / answer / development / cadence 变形。
 * 这里只产出计划（句界、角色、轮廓、级数步、把位窗口），不碰音高与节奏。
 */

import type {
    FretRange,
    MelodicContour,
    PhrasePlan,
    PhraseRole,
    PhraseVariation,
    PlayabilityRules,
    ResolvedImprovOptions,
    StyleProfile,
} from '../../types/improv.ts';
import { pickWeighted, randInt } from './random.ts';

/** 轮廓偏置：每一步优先朝轮廓方向走的级数 */
const CONTOUR_STEPS: Record<MelodicContour, readonly number[]> = {
    ascending: [1, 1, 1, 2, 1, -1],
    descending: [-1, -1, -1, -2, -1, 1],
    arch: [1, 1, 2, 1, -1, -1],
    wave: [1, -1, 1, -1, 2, -2],
};

function randomStep(rng: () => number): number {
    return pickWeighted(rng, [
        { value: -2, weight: 0.12 },
        { value: -1, weight: 0.32 },
        { value: 0, weight: 0.08 },
        { value: 1, weight: 0.32 },
        { value: 2, weight: 0.16 },
    ]);
}

/**
 * 按轮廓生成级数步。
 *
 * 60% 跟随轮廓偏置，40% 随机；连续 3 步同向后强制反向，
 * 避免出现一条只会往一个方向爬的音阶练习。
 */
function buildSteps(
    length: number,
    contour: MelodicContour,
    rng: () => number,
): number[] {
    const bias = CONTOUR_STEPS[contour];
    const steps: number[] = [];
    let runSign = 0;
    let runLength = 0;

    for (let index = 0; index < length; index++) {
        let step = rng() < 0.6
            ? bias[index % bias.length]
            : randomStep(rng);

        const sign = Math.sign(step);
        if (sign !== 0 && sign === runSign) {
            runLength++;
            if (runLength >= 3) {
                step = -sign * Math.max(1, Math.abs(step));
                runSign = -sign;
                runLength = 1;
            }
        } else if (sign !== 0) {
            runSign = sign;
            runLength = 1;
        }
        steps.push(step);
    }

    let allZero = true;
    for (const step of steps) {
        if (step !== 0) {
            allZero = false;
            break;
        }
    }
    if (allZero) steps[0] = 1;
    return steps;
}

function rolesFor(count: number): PhraseRole[] {
    const roles: PhraseRole[] = new Array(count).fill('answer');
    roles[0] = 'statement';
    if (count > 1) roles[count - 1] = 'cadence';
    for (let index = 1; index < count - 1; index++) {
        roles[index] = index % 2 === 1 ? 'answer' : 'development';
    }
    return roles;
}

function variationFor(
    role: PhraseRole,
    rng: () => number,
): { variation: PhraseVariation; transposeSteps: number } {
    if (role === 'answer') {
        if (rng() < 0.7) return { variation: 'tail', transposeSteps: 0 };
        return { variation: 'sequence', transposeSteps: randInt(rng, -2, 2) || 1 };
    }
    if (role === 'development') {
        if (rng() < 0.55) {
            return { variation: 'sequence', transposeSteps: randInt(rng, -3, 3) || 1 };
        }
        return { variation: 'inversion', transposeSteps: 0 };
    }
    if (role === 'cadence') return { variation: 'cadence', transposeSteps: 0 };
    return { variation: 'literal', transposeSteps: 0 };
}

function deriveSteps(
    base: readonly number[],
    variation: PhraseVariation,
    contour: MelodicContour,
    rng: () => number,
): number[] {
    const headLength = Math.max(1, Math.ceil(base.length / 2));

    if (variation === 'tail') {
        return [
            ...base.slice(0, headLength),
            ...buildSteps(base.length - headLength, contour, rng),
        ];
    }
    if (variation === 'inversion') {
        return base.map(step => -step);
    }
    if (variation === 'cadence') {
        return [
            ...base.slice(0, headLength),
            ...buildSteps(base.length - headLength, 'descending', rng),
        ];
    }
    // literal / sequence / rhythmic 共用级数步；sequence 的位移在句首体现
    return [...base];
}

/**
 * 一句的把位窗口。
 *
 * 低把位窗口从偏好范围下沿取 maxHandSpan + 1 品；development 用上沿，
 * answer 按 shiftProbability 往上移 shiftFrets 品。窗口窄于 3 品时直接用
 * 整个偏好范围，避免把可弹音缩到没有。
 */
function windowFor(
    role: PhraseRole,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
    fixedRange: FretRange | null,
): { fretMin: number; fretMax: number } {
    // 用户锁定把位时所有乐句都用同一个窗口，风格偏好不再收窄或换把。
    if (fixedRange) {
        return {
            fretMin: Math.max(playability.fretMin, fixedRange.min),
            fretMax: Math.min(playability.fretMax, fixedRange.max),
        };
    }

    const baseMin = Math.max(playability.fretMin, style.preferredFretMin);
    const baseMax = Math.min(playability.fretMax, style.preferredFretMax);
    if (baseMax - baseMin + 1 <= 3) return { fretMin: baseMin, fretMax: baseMax };

    const span = Math.max(3, playability.maxHandSpan + 1);
    if (baseMax - baseMin + 1 <= span) {
        return { fretMin: baseMin, fretMax: baseMax };
    }

    const lowMin = baseMin;
    const highMin = baseMax - span + 1;
    if (role === 'development') {
        return { fretMin: highMin, fretMax: baseMax };
    }
    if (role === 'answer' && rng() < style.phrase.shiftProbability) {
        const shifted = Math.min(baseMax - 1, baseMin + Math.max(1, style.phrase.shiftFrets));
        const fretMin = Math.max(lowMin, Math.min(highMin, shifted));
        return { fretMin, fretMax: Math.min(baseMax, fretMin + span - 1) };
    }
    return { fretMin: lowMin, fretMax: Math.min(baseMax, lowMin + span - 1) };
}

/**
 * 生成整段乐句计划。
 *
 * 句长取 `style.phrase.measures`；最后一句可以短于句长。角色固定为
 * 首句 statement、末句 cadence，中间交替 answer / development。
 */
export function buildPhrasePlan(
    options: ResolvedImprovOptions,
    style: StyleProfile,
    playability: PlayabilityRules,
    rng: () => number,
): PhrasePlan[] {
    const phraseMeasures = Math.max(1, Math.round(style.phrase.measures));
    const phraseCount = Math.max(1, Math.ceil(options.numMeasures / phraseMeasures));
    const roles = rolesFor(phraseCount);
    const contours = style.phrase.contours.length > 0
        ? style.phrase.contours
        : (['arch'] as const);
    const motifLength = Math.max(1, Math.round(style.motifLength));
    const baseSteps = buildSteps(motifLength, contours[0], rng);

    const phrases: PhrasePlan[] = [];
    for (let index = 0; index < phraseCount; index++) {
        const role = roles[index];
        const contour = contours[index % contours.length];
        const startMeasure = index * phraseMeasures;
        const endMeasure = Math.min(options.numMeasures, startMeasure + phraseMeasures);
        const { variation, transposeSteps } = variationFor(role, rng);
        const steps = index === 0
            ? [...baseSteps]
            : deriveSteps(baseSteps, variation, contour, rng);
        const { fretMin, fretMax } = windowFor(
            role, style, playability, rng, options.fretRange,
        );

        phrases.push({
            index,
            startMeasure,
            endMeasure,
            role,
            contour,
            variation,
            sourcePhrase: index === 0 ? null : 0,
            transposeSteps,
            registerShift: 0,
            fretMin,
            fretMax,
            steps,
        });
    }

    return phrases;
}

/** 小节 → 乐句；越界时回落到最后一句 */
export function phraseForMeasure(
    phrases: readonly PhrasePlan[],
    measureIndex: number,
): PhrasePlan {
    return phrases.find(phrase =>
        measureIndex >= phrase.startMeasure && measureIndex < phrase.endMeasure,
    ) ?? phrases[phrases.length - 1];
}

/** 校验乐句计划覆盖全部小节、句界连续、角色与窗口合法 */
export function validatePhrasePlan(
    phrases: readonly PhrasePlan[],
    options: ResolvedImprovOptions,
): string[] {
    const errors: string[] = [];
    if (phrases.length === 0) return ['乐句计划为空'];

    let expectedStart = 0;
    phrases.forEach((phrase, index) => {
        if (phrase.index !== index) {
            errors.push(`第 ${index + 1} 句 index 应为 ${index}`);
        }
        if (phrase.startMeasure !== expectedStart) {
            errors.push(`第 ${index + 1} 句应从第 ${expectedStart + 1} 小节开始`);
        }
        if (phrase.endMeasure <= phrase.startMeasure) {
            errors.push(`第 ${index + 1} 句没有小节`);
        }
        if (phrase.steps.length === 0) {
            errors.push(`第 ${index + 1} 句没有级数步`);
        }
        if (phrase.fretMin < 0 || phrase.fretMax > 24
            || phrase.fretMin > phrase.fretMax) {
            errors.push(`第 ${index + 1} 句把位窗口非法: ${phrase.fretMin}-${phrase.fretMax}`);
        }
        if (index === 0 && phrase.role !== 'statement') {
            errors.push('第一句必须是 statement');
        }
        if (phrases.length > 1 && index === phrases.length - 1
            && phrase.role !== 'cadence') {
            errors.push('最后一句必须是 cadence');
        }
        if (phrase.sourcePhrase !== null
            && (phrase.sourcePhrase < 0 || phrase.sourcePhrase >= index)) {
            errors.push(`第 ${index + 1} 句的动机来源非法`);
        }
        expectedStart = phrase.endMeasure;
    });

    if (expectedStart !== options.numMeasures) {
        errors.push(`乐句覆盖 ${expectedStart} 小节，期望 ${options.numMeasures}`);
    }
    return errors;
}
