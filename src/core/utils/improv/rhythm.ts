/**
 * rhythm — 按密度/风格生成节奏计划（纯函数）。
 *
 * 关键约束：每小节 slots 的时值之和必须**精确**等于小节容量，
 * 否则下游 scoreStore.loadNotes 会按容量重新切小节，句子边界会漂。
 * 内部统一用 1/32 音符为整数单位，避免 0.25/0.125 的浮点误差。
 */

import type { NoteDuration } from '../../types/index.ts';
import type {
    DensityProfile,
    DurationWeight,
    ResolvedImprovOptions,
    RhythmMeasure,
    RhythmSlot,
    SlotRole,
    StyleProfile,
} from '../../types/improv.ts';
import { parseTimeSignature, capacityFromTimeSignature } from '../measureUtils.ts';
import { pickWeighted } from './random.ts';

/** 全音符 = 32 个 1/32 单位 */
const UNITS_PER_WHOLE = 32;

function toUnits(duration: NoteDuration): number {
    return Math.round(duration * UNITS_PER_WHOLE);
}

/** 候选项：密度允许的时值 + 0.125 兜底；不生成 1/32 音符，避免碎音 */
interface DurationCandidate {
    duration: NoteDuration;
    units: number;
    weight: number;
}

function buildDurationCandidates(
    density: DensityProfile,
    style: StyleProfile,
): DurationCandidate[] {
    const densityWeights = new Map<NoteDuration, number>(
        density.durations.map((item: DurationWeight) => [item.duration, item.weight]),
    );
    const styleWeights = new Map<NoteDuration, number>(
        style.durations.map((item: DurationWeight) => [item.duration, item.weight]),
    );

    // 0.125 是容量闭合的兜底：配置里的所有拍号容量都是 0.125 的整数倍。
    const durations = new Set<NoteDuration>([
        ...density.durations.map(item => item.duration),
        0.125,
    ]);

    return Array.from(durations)
        // 只排除 1/32（0.03125）；0.0625 是配置里真实存在的十六分权重。
        .filter(duration => duration >= 0.0625)
        .sort((a, b) => b - a)
        .map(duration => {
            const densityWeight = densityWeights.get(duration) ?? 0.05;
            const styleWeight = styleWeights.get(duration) ?? 0.5;
            return {
                duration,
                units: toUnits(duration),
                // 密度决定“能不能出现”，风格只做偏好加权
                weight: densityWeight * (0.5 + styleWeight),
            };
        });
}

/** 剩余整数单位能否由给定候选时值恰好填满 */
function canFillUnits(remainingUnits: number, candidates: readonly DurationCandidate[]): boolean {
    if (remainingUnits < 0) return false;
    const possible = new Array<boolean>(remainingUnits + 1).fill(false);
    possible[0] = true;
    for (let units = 1; units <= remainingUnits; units++) {
        possible[units] = candidates.some(candidate =>
            candidate.units <= units && possible[units - candidate.units]);
    }
    return possible[remainingUnits];
}

/** 对外便利版：以全音符为单位，检查能否恰好填满 */
export function canFill(remaining: number, durations: readonly NoteDuration[]): boolean {
    const remainingUnits = Math.round(remaining * UNITS_PER_WHOLE);
    if (remainingUnits < 0) return false;
    const candidates = durations.map(duration => ({
        duration,
        units: toUnits(duration),
        weight: 1,
    }));
    return canFillUnits(remainingUnits, candidates);
}

/**
 * 拍位角色：强拍、弱拍、经过音。
 *
 * 简单拍号按 2 拍一组；复合拍号（6/8、9/8、12/8）按 3 个八分一组；
 * 7/8 按 2+2+3 的重音位置处理。
 */
function classifyRole(
    offsetUnits: number,
    durationUnits: number,
    timeSignature: string,
): SlotRole {
    const { numerator, denominator } = parseTimeSignature(timeSignature);
    const beatUnits = UNITS_PER_WHOLE / denominator;
    const beatIndex = Math.floor((offsetUnits + 1e-6) / beatUnits);
    // 细分拍位（如 4/4 的反拍八分）落在某一拍内部，不能因为“所在拍”是
    // 强拍就继承 strong——强拍必须是 offset 正好踩在拍点上。
    const onBeat = offsetUnits % beatUnits === 0;

    let strong = false;
    if (onBeat) {
        if (denominator === 8 && numerator === 7) {
            // 7/8 按 2+2+3 分组
            strong = beatIndex === 0 || beatIndex === 2 || beatIndex === 4;
        } else if (denominator === 8 && numerator % 3 === 0) {
            // 6/8、9/8、12/8 按附点四分（3 个八分）分组
            strong = beatIndex % 3 === 0;
        } else if (numerator === 4) {
            strong = beatIndex % 2 === 0;
        } else if (numerator === 5) {
            // 5/4 按 3+2 分组
            strong = beatIndex === 0 || beatIndex === 3;
        } else {
            // 2/2、2/4、3/4 只有第一拍是强拍
            strong = beatIndex === 0;
        }
    }

    if (strong) return 'strong';
    return durationUnits <= toUnits(0.125) ? 'passing' : 'weak';
}

/**
 * 保证拍位数不少于 minNotes。
 *
 * 随机选时值可能把小节压成很少的拍位（例如 2/4 只抽到一个 0.5），
 * 此时 ensureSoundingNotes 无法再翻出更多音符。这里把最长的拍位二分，
 * 总容量不变；拆分后由 reassignRoles 重新标注拍位角色。
 */
function ensureMinimumSlots(slots: RhythmSlot[], minNotes: number): void {
    while (slots.length < minNotes) {
        let longestIndex = -1;
        for (let index = 0; index < slots.length; index++) {
            const duration = slots[index].duration;
            if (duration >= 0.125
                && (longestIndex < 0 || duration > slots[longestIndex].duration)) {
                longestIndex = index;
            }
        }
        if (longestIndex < 0) {
            throw new Error(`无法把节奏拆到至少 ${minNotes} 个拍位`);
        }

        const source = slots[longestIndex];
        const half = (source.duration / 2) as NoteDuration;
        slots.splice(
            longestIndex,
            1,
            { duration: half, isRest: source.isRest, role: source.role },
            { duration: half, isRest: source.isRest, role: source.role },
        );
    }
}

/** 按最终时值顺序重新标注拍位角色（拆分后 offset 会变化） */
function reassignRoles(slots: RhythmSlot[], timeSignature: string): void {
    let offsetUnits = 0;
    for (const slot of slots) {
        const durationUnits = toUnits(slot.duration);
        slot.role = classifyRole(offsetUnits, durationUnits, timeSignature);
        offsetUnits += durationUnits;
    }
}

/** 保证每小节至少 minNotes 个发音，优先把弱拍/经过音的休止翻成音符 */
function ensureSoundingNotes(slots: RhythmSlot[], minNotes: number): void {
    const sounding = () => slots.filter(slot => !slot.isRest).length;
    if (sounding() === 0) {
        slots[0].isRest = false;
        return;
    }

    const candidates = slots
        .map((slot, index) => ({ slot, index }))
        .filter(({ slot }) => slot.isRest)
        .sort((a, b) => {
            const roleCost = (role: SlotRole) => role === 'passing' ? 0 : role === 'weak' ? 1 : 2;
            return roleCost(a.slot.role) - roleCost(b.slot.role) || a.index - b.index;
        });

    for (const { slot } of candidates) {
        if (sounding() >= minNotes) break;
        slot.isRest = false;
    }
}

/**
 * 生成整段节奏计划。
 *
 * @param options 已补齐的生成选项（numMeasures / timeSignature）
 * @param density 密度参数
 * @param style   风格参数
 * @param rng     确定性随机源
 */
export function buildRhythmPlan(
    options: ResolvedImprovOptions,
    density: DensityProfile,
    style: StyleProfile,
    rng: () => number,
): RhythmMeasure[] {
    const capacity = capacityFromTimeSignature(options.timeSignature);
    if (!Number.isFinite(capacity) || capacity <= 0) {
        throw new Error(`无效拍号: ${options.timeSignature}`);
    }
    const capacityUnits = Math.round(capacity * UNITS_PER_WHOLE);
    if (capacityUnits % 2 !== 0) {
        throw new Error(`拍号容量无法用当前时值精确闭合: ${options.timeSignature}`);
    }

    const candidates = buildDurationCandidates(density, style);
    if (candidates.length === 0) {
        throw new Error('没有可用的节奏时值');
    }

    const measures: RhythmMeasure[] = [];
    for (let measureIndex = 0; measureIndex < options.numMeasures; measureIndex++) {
        const slots: RhythmSlot[] = [];
        let remainingUnits = capacityUnits;
        let offsetUnits = 0;
        let restStreak = 0;

        while (remainingUnits > 0) {
            const feasible = candidates.filter(candidate =>
                candidate.units <= remainingUnits
                && canFillUnits(remainingUnits - candidate.units, candidates));
            if (feasible.length === 0) {
                throw new Error(`节奏无法闭合: 剩余 ${remainingUnits}/32`);
            }

            const chosen = pickWeighted(
                rng,
                feasible.map(candidate => ({ value: candidate, weight: candidate.weight })),
            );

            const isFirst = slots.length === 0;
            // 第一个拍位必须是音符；连续休止越多，继续休止的概率越低
            const restFactor = restStreak === 0 ? 1 : restStreak === 1 ? 0.3 : 0;
            const isRest = !isFirst
                && remainingUnits > chosen.units
                && rng() < density.restProbability * restFactor;

            const role = classifyRole(offsetUnits, chosen.units, options.timeSignature);
            slots.push({ duration: chosen.duration, isRest, role });

            offsetUnits += chosen.units;
            remainingUnits -= chosen.units;
            restStreak = isRest ? restStreak + 1 : 0;
        }

        ensureMinimumSlots(slots, density.minNotesPerMeasure);
        reassignRoles(slots, options.timeSignature);
        ensureSoundingNotes(slots, density.minNotesPerMeasure);
        measures.push({ index: measureIndex, capacity, slots });
    }

    return measures;
}
