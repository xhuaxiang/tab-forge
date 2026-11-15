/**
 * practice — 练习意图 → 风格参数（纯函数）。
 *
 * 只缩放「表现层」概率并收紧单步跳进；时值权重、重音/轻音、动机长度、
 * 音区与把位偏好都不动：练习模式改变的是「加多少花」，不是「弹什么音」。
 */

import type {
    PracticeFocus,
    PracticeProfile,
    StyleProfile,
} from '../../types/improv/index.ts';

/**
 * 受练习预设缩放的表情类概率字段。
 *
 * 刻意不包含 accent / soft（基本律动）与 repetition（结构重复），
 * 也不含 naturalHarmonicShare / pinchHarmonicShare（外层 harmonic 已缩放）。
 */
const SCALED_KEYS = [
    'bendProbability',
    'vibratoProbability',
    'palmMuteProbability',
    'hammerPullProbability',
    'slideProbability',
    'deadNoteProbability',
    'staccatoProbability',
    'letRingProbability',
    'harmonicProbability',
    'chordProbability',
    'secondVoicingProbability',
    'arpeggioProbability',
    'strumProbability',
] as const satisfies readonly (keyof StyleProfile)[];

/**
 * 应用练习预设，返回新的 `StyleProfile`（不修改入参）。
 *
 * `maxLeapSemitones` 只收紧不放大：取风格值与预设上限的较小者。
 */
export function applyPracticeProfile(
    style: StyleProfile,
    practice: PracticeFocus,
    profiles: Record<PracticeFocus, PracticeProfile>,
): StyleProfile {
    const profile = profiles[practice];
    const rawScale = profile?.expressionScale ?? 1;
    const scale = Number.isFinite(rawScale) ? Math.max(0, rawScale) : 1;
    const cap = profile?.maxLeapSemitones ?? null;

    const next: StyleProfile = {
        ...style,
        phrase: { ...style.phrase },
    };
    for (const key of SCALED_KEYS) {
        next[key] = style[key] * scale;
    }
    next.maxLeapSemitones = cap === null
        ? style.maxLeapSemitones
        : Math.min(style.maxLeapSemitones, cap);

    // 锁定把位时句间不换把；与 resolve 的 4 品窗口互为双保险
    if (profile?.keepPosition) next.phrase.shiftProbability = 0;

    return next;
}
