/**
 * rhythm — 按密度/风格生成节奏计划（纯函数）。
 *
 * 关键约束：每小节 slots 的时值之和必须**精确**等于小节容量，
 * 否则下游 scoreStore.loadNotes 会按容量重新切小节，句子边界会漂。
 * 内部统一用 1/32 音符为整数单位，避免 0.25/0.125 的浮点误差。
 */

import { NOTE_DURATIONS } from '../../types/index.ts';
import type { NoteDuration } from '../../types/index.ts';
import type {
    DensityProfile,
    DurationWeight,
    HarmonyMeasure,
    PhrasePlan,
    ResolvedImprovOptions,
    RhythmMeasure,
    RhythmSlot,
    SlotRole,
    StyleProfile,
} from '../../types/improv/index.ts';
import { parseTimeSignature, capacityFromTimeSignature } from '../measureUtils.ts';
import { t } from '../../i18n/index.ts';
import { pickWeighted } from './random.ts';

/** 全音符 = 32 个 1/32 单位 */
export const UNITS_PER_WHOLE = 32;

/** 时值 → 1/32 单位（节奏层与终止式共用，避免浮点累加误差） */
export function durationToUnits(duration: NoteDuration): number {
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
                units: durationToUnits(duration),
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
        units: durationToUnits(duration),
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
    return durationUnits <= durationToUnits(0.125) ? 'passing' : 'weak';
}

/** 对外便利版：offset/duration 以全音符为单位 */
export function classifySlotRole(
    offset: number,
    duration: NoteDuration,
    timeSignature: string,
): SlotRole {
    return classifyRole(
        Math.round(offset * UNITS_PER_WHOLE),
        durationToUnits(duration),
        timeSignature,
    );
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
            throw new Error(t('improv.rhythm.splitFailed', { min: minNotes }));
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
        const durationUnits = durationToUnits(slot.duration);
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

/** 生成一小节的拍位（容量精确闭合、发音数达标） */
function buildMeasureSlots(
    options: ResolvedImprovOptions,
    density: DensityProfile,
    candidates: readonly DurationCandidate[],
    capacityUnits: number,
    rng: () => number,
): RhythmSlot[] {
    const slots: RhythmSlot[] = [];
    let remainingUnits = capacityUnits;
    let offsetUnits = 0;
    let restStreak = 0;

    while (remainingUnits > 0) {
        const feasible = candidates.filter(candidate =>
            candidate.units <= remainingUnits
            && canFillUnits(remainingUnits - candidate.units, candidates));
        if (feasible.length === 0) {
            throw new Error(t('improv.rhythm.notClosed', { remaining: remainingUnits }));
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
    return slots;
}

function cloneSlots(slots: readonly RhythmSlot[]): RhythmSlot[] {
    return slots.map(slot => ({ ...slot }));
}

function soundingCount(slots: readonly RhythmSlot[]): number {
    return slots.filter(slot => !slot.isRest).length;
}

/** 把某个拍位一分为二；时值必须仍是合法音符（不生成 1/32） */
function splitOneSlot(slots: RhythmSlot[], rng: () => number): boolean {
    const indices: number[] = [];
    slots.forEach((slot, index) => {
        const half = slot.duration / 2;
        if (slot.duration >= 0.125
            && NOTE_DURATIONS.includes(half as NoteDuration)
            && half >= 0.0625) {
            indices.push(index);
        }
    });
    if (indices.length === 0) return false;

    const index = indices[Math.floor(rng() * indices.length)];
    const source = slots[index];
    const half = (source.duration / 2) as NoteDuration;
    slots.splice(
        index,
        1,
        { duration: half, isRest: source.isRest, role: source.role },
        { duration: half, isRest: source.isRest, role: source.role },
    );
    return true;
}

/** 合并相邻两拍；合并后的总时值必须仍是合法音符 */
function mergeTwoSlots(
    slots: RhythmSlot[],
    minNotes: number,
    rng: () => number,
): boolean {
    if (slots.length <= minNotes) return false;

    const indices: number[] = [];
    for (let index = 0; index + 1 < slots.length; index++) {
        const total = slots[index].duration + slots[index + 1].duration;
        if (NOTE_DURATIONS.includes(total as NoteDuration)) indices.push(index);
    }
    if (indices.length === 0) return false;

    const index = indices[Math.floor(rng() * indices.length)];
    const first = slots[index];
    const second = slots[index + 1];
    slots.splice(index, 2, {
        duration: (first.duration + second.duration) as NoteDuration,
        isRest: first.isRest && second.isRest,
        role: first.role,
    });
    return true;
}

/** 翻转一个非首拍位的休止状态；翻成休止时不能低于密度下限 */
function toggleOneRest(
    slots: RhythmSlot[],
    minNotes: number,
    rng: () => number,
): boolean {
    const indices: number[] = [];
    slots.forEach((slot, index) => {
        if (index === 0) return;
        if (slot.isRest) {
            indices.push(index);
        } else if (soundingCount(slots) > minNotes) {
            indices.push(index);
        }
    });
    if (indices.length === 0) return false;

    const index = indices[Math.floor(rng() * indices.length)];
    slots[index].isRest = !slots[index].isRest;
    return true;
}

/**
 * 按乐句角色做一次节奏变形。
 *
 * 只做「拆分 / 合并 / 翻转休止」三种保持总容量的操作；候选操作按角色
 * 排序，第一个成功的生效。这样句内第二小节不会和第一小节一模一样，
 * 又不会破坏容量闭合。
 */
function varySlots(
    slots: RhythmSlot[],
    role: PhrasePlan['role'],
    minNotes: number,
    rng: () => number,
): RhythmSlot[] {
    const operations = role === 'development'
        ? ['split', 'merge', 'toggle']
        : role === 'cadence'
            ? ['merge', 'toggle', 'split']
            : ['toggle', 'split', 'merge'];

    for (const operation of operations) {
        if (operation === 'split' && splitOneSlot(slots, rng)) return slots;
        if (operation === 'merge' && mergeTwoSlots(slots, minNotes, rng)) return slots;
        if (operation === 'toggle' && toggleOneRest(slots, minNotes, rng)) return slots;
    }
    return slots;
}

/** 非末句的句尾呼吸：把最后一个可休止的发音改为休止 */
function applyPhraseEndRest(
    slots: RhythmSlot[],
    minNotes: number,
    rng: () => number,
): void {
    if (slots.length <= 1 || soundingCount(slots) <= minNotes) return;
    const indices: number[] = [];
    slots.forEach((slot, index) => {
        if (index > 0 && !slot.isRest) indices.push(index);
    });
    if (indices.length === 0) return;
    // 优先真正的小节末拍位；没有就用倒数第二个可休止音
    const last = indices[indices.length - 1];
    const target = rng() < 0.7 ? last : indices[Math.floor(rng() * indices.length)];
    slots[target].isRest = true;
}

/**
 * 生成整段节奏计划。
 *
 * 不传 `phrases` 时保持旧的逐小节随机行为；传入乐句计划后，每句复用
 * 一个小节节奏 cell，句内后续小节按角色拆分/合并/翻转休止。
 *
 * @param options 已补齐的生成选项（numMeasures / timeSignature）
 * @param density 密度参数
 * @param style   风格参数
 * @param rng     确定性随机源
 * @param phrases 可选的乐句计划；有它才启用乐句节奏
 */
export function buildRhythmPlan(
    options: ResolvedImprovOptions,
    density: DensityProfile,
    style: StyleProfile,
    rng: () => number,
    phrases?: readonly PhrasePlan[],
): RhythmMeasure[] {
    const capacity = capacityFromTimeSignature(options.timeSignature);
    if (!Number.isFinite(capacity) || capacity <= 0) {
        throw new Error(t('improv.common.invalidTimeSignature', {
            signature: options.timeSignature,
        }));
    }
    const capacityUnits = Math.round(capacity * UNITS_PER_WHOLE);
    if (capacityUnits % 2 !== 0) {
        throw new Error(t('improv.rhythm.capacityNotClosed', {
            signature: options.timeSignature,
        }));
    }

    const candidates = buildDurationCandidates(density, style);
    if (candidates.length === 0) {
        throw new Error(t('improv.rhythm.noDurations'));
    }

    if (phrases === undefined || phrases.length === 0) {
        const measures: RhythmMeasure[] = [];
        for (let measureIndex = 0; measureIndex < options.numMeasures; measureIndex++) {
            measures.push({
                index: measureIndex,
                capacity,
                slots: buildMeasureSlots(
                    options, density, candidates, capacityUnits, rng,
                ),
            });
        }
        return measures;
    }

    const measures: RhythmMeasure[] = [];
    for (const phrase of phrases) {
        const base = buildMeasureSlots(
            options, density, candidates, capacityUnits, rng,
        );
        for (let measureIndex = phrase.startMeasure;
            measureIndex < phrase.endMeasure;
            measureIndex++) {
            const isFirstOfPhrase = measureIndex === phrase.startMeasure;
            const slots = cloneSlots(base);
            if (!isFirstOfPhrase) {
                varySlots(slots, phrase.role, density.minNotesPerMeasure, rng);
            }
            if (measureIndex === phrase.endMeasure - 1
                && phrase.index < phrases.length - 1
                && rng() < style.phrase.endRestProbability) {
                applyPhraseEndRest(slots, density.minNotesPerMeasure, rng);
            }

            ensureMinimumSlots(slots, density.minNotesPerMeasure);
            reassignRoles(slots, options.timeSignature);
            ensureSoundingNotes(slots, density.minNotesPerMeasure);
            measures.push({
                index: measureIndex,
                capacity,
                slots,
                phraseIndex: phrase.index,
            });
        }
    }

    return measures;
}

/**
 * 终止式：把全曲最后一个发音拍位延长到至少 `minDuration`。
 *
 * 先吃末音**之后**的休止；不够时再把前缀里最长的拍位逐次减半借时间——
 * 发音最多缩到 0.0625（节奏层不生成 1/32），休止可整个并掉，因此每小节
 * 发音数与密度下限不变。借多了的零头放在终止音之前当休止，小节容量仍
 * 精确闭合。
 *
 * 终止音整体落在最后一个和弦段内：和弦在小节中间切换时，不把旧和弦的
 * 音拖到新和弦上；末音已经够长、但确实跨过和弦边界且后面还有休止时，等长
 * 挪到小节末尾。时值集合只有二等分时值（无附点/三连音），优先取「不小于
 * 下限的最小合法时值」；
 * 容量/密度不允许（如 2/4 下 0.5 占满整小节）时退回能放下的最长合法时值。
 * 终止式只加长或等长后移，不缩短已有末音：最后一个和弦段本身比末音还短时
 * 保持原样（该跨段是生成器既有形态）；没有任何可借拍位时也原样返回。
 * 不修改入参。
 *
 * @param plan    节奏计划（通常来自 buildRhythmPlan）
 * @param options 已补齐的生成选项（拍号用于重标拍位角色）
 * @param harmony 可选的和声计划；提供时尽量不跨和弦段，末段短于末音或
 *                无可借时长时保留原形态
 * @param minDuration 终止音的最短时值
 */
export function applyCadence(
    plan: RhythmMeasure[],
    options: ResolvedImprovOptions,
    harmony: readonly HarmonyMeasure[] | undefined,
    minDuration: NoteDuration,
): RhythmMeasure[] {
    let measurePos = plan.length - 1;
    while (measurePos >= 0 && !plan[measurePos].slots.some(slot => !slot.isRest)) {
        measurePos--;
    }
    if (measurePos < 0) return plan;

    const measure = plan[measurePos];
    const slots = measure.slots;
    let finalIndex = slots.length - 1;
    while (finalIndex >= 0 && slots[finalIndex].isRest) finalIndex--;
    if (finalIndex < 0) return plan;

    const measureUnits = slots.reduce(
        (sum, slot) => sum + durationToUnits(slot.duration), 0,
    );
    if (measureUnits <= 0) return plan;
    const finalUnits = durationToUnits(slots[finalIndex].duration);

    let finalOffsetUnits = 0;
    for (let index = 0; index < finalIndex; index++) {
        finalOffsetUnits += durationToUnits(slots[index].duration);
    }

    let trailingUnits = 0;
    for (let index = finalIndex + 1; index < slots.length; index++) {
        trailingUnits += durationToUnits(slots[index].duration);
    }
    const availableUnits = finalUnits + trailingUnits;

    // 终止音必须整体落在最后一个和弦段内。段起点不一定落在 1/32 网格上，
    // 向上取整，保证终止音不早于段起点。
    const harmonyMeasure = harmony?.[measure.index];
    const lastSegment = harmonyMeasure?.segments[harmonyMeasure.segments.length - 1];
    const segmentStartUnits = lastSegment
        ? Math.ceil(lastSegment.start * UNITS_PER_WHOLE - 1e-6)
        : 0;
    const segmentRoomUnits = measureUnits - segmentStartUnits;
    // 末音是否真的跨过最后一个和弦段的起点；只有跨段时等长后移才有意义。
    const finalCrossesSegment = finalOffsetUnits < segmentStartUnits
        && finalOffsetUnits + finalUnits > segmentStartUnits;

    // 上限分两套：任何候选都不能超出最后一个和弦段；加长型候选还受
    // 「不小于下限的最小合法时值」约束，避免一步拖成整小节。末音已经够长时
    // 不加长，只在确实跨段且后面还有休止时等长挪到段起点之后（也就是小节
    // 末尾），让终止音落在最后一个和弦上。
    const minUnits = durationToUnits(minDuration);
    let preferredUnits = Number.POSITIVE_INFINITY;
    for (const duration of NOTE_DURATIONS) {
        const units = durationToUnits(duration);
        if (units >= minUnits && units < preferredUnits) preferredUnits = units;
    }
    const candidates = NOTE_DURATIONS
        .map(duration => durationToUnits(duration))
        .filter(units => {
            if (units > segmentRoomUnits) return false;
            if (units > finalUnits) return units <= preferredUnits;
            return units === finalUnits
                && finalCrossesSegment
                && trailingUnits > 0;
        })
        .sort((a, b) => b - a);

    // 前缀能借出的时间：发音最多缩到 0.0625（节奏层不生成 1/32，避免碎音），
    // 休止可以整个并掉。
    const prefix = slots.slice(0, finalIndex);
    const maxBorrowUnits = prefix.reduce(
        (sum, slot) => {
            const units = durationToUnits(slot.duration);
            return sum + (slot.isRest ? units : Math.max(0, units - 2));
        },
        0,
    );

    for (const targetUnits of candidates) {
        const needUnits = Math.max(0, targetUnits - availableUnits);
        if (needUnits > maxBorrowUnits) continue;

        const newSlots: RhythmSlot[] = prefix.map(slot => ({ ...slot }));
        let borrowedUnits = 0;
        while (borrowedUnits < needUnits) {
            // 每次挑最长的可缩短拍位减半：优先缩短长音，避免把临近的短音
            // 压碎；休止也可以缩，缩到 0 直接并掉。等长时取靠右的。
            let pickIndex = -1;
            let pickUnits = 0;
            for (let index = newSlots.length - 1; index >= 0; index--) {
                const units = durationToUnits(newSlots[index].duration);
                const shrinkable = newSlots[index].isRest ? units >= 1 : units > 2;
                if (shrinkable && units > pickUnits) {
                    pickIndex = index;
                    pickUnits = units;
                }
            }
            if (pickIndex < 0) break;
            // 休止本身不承载发音，≤0.0625 的直接并掉，避免切出 1/32 休止。
            const keepUnits = newSlots[pickIndex].isRest && pickUnits <= 2
                ? 0
                : pickUnits / 2;
            const keepDuration = (keepUnits / UNITS_PER_WHOLE) as NoteDuration;
            // NOTE_DURATIONS 全是 2 的幂，减半必然合法；显式校验防未来加入
            // 附点时值后 cast 掩盖出非法时值。
            if (keepUnits > 0 && !NOTE_DURATIONS.includes(keepDuration)) break;
            borrowedUnits += pickUnits - keepUnits;
            if (keepUnits === 0) newSlots.splice(pickIndex, 1);
            else newSlots[pickIndex] = {
                ...newSlots[pickIndex],
                duration: keepDuration,
            };
        }
        if (borrowedUnits < needUnits) continue;

        // 借来的零头（含原来的尾随休止）放在终止音之前，容量精确闭合
        let restUnits = availableUnits + borrowedUnits - targetUnits;
        for (const duration of NOTE_DURATIONS) {
            const units = durationToUnits(duration);
            while (restUnits >= units) {
                newSlots.push({ duration, isRest: true, role: 'weak' });
                restUnits -= units;
            }
        }
        newSlots.push({
            duration: (targetUnits / UNITS_PER_WHOLE) as NoteDuration,
            isRest: false,
            role: 'weak',
        });
        reassignRoles(newSlots, options.timeSignature);

        return plan.map((item, index) => index === measurePos
            ? { ...item, slots: newSlots }
            : item);
    }

    return plan;
}
