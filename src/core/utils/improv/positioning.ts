/**
 * positioning — 为旋律骨架选把位（Viterbi 动态规划，纯函数）。
 *
 * 同一个 MIDI 音在吉他上通常有多个 (弦, 品) 候选；和弦拍位则需要一整组
 * 可同时按出的位置。DP 的代价同时考虑风格偏好把位、把位内品位跨度、
 * 跨弦距离与同音重复；结果对同一输入完全确定。
 *
 * 单声部是 voicing 元组长度为 1 的特例，代价与候选顺序都与旧实现一致。
 */

import type {
    FretPosition,
    PlayabilityRules,
    PositionedSlot,
    ResolvedImprovOptions,
    SkeletonSlot,
    StyleProfile,
} from '../../types/improv.ts';
import { voicingCandidatesForMidis } from './voicing.ts';

interface State {
    positions: FretPosition[];
    cost: number;
    /** 上一层候选的下标；第一层为 -1 */
    previous: number;
}

/** 单个位置的静态代价：偏好把位之外、过高把位、空弦奖励 */
function positionCost(
    position: FretPosition,
    style: StyleProfile,
): number {
    let cost = position.fret * 0.02;

    if (position.fret < style.preferredFretMin) {
        cost += (style.preferredFretMin - position.fret) * 0.35;
    }
    if (position.fret > style.preferredFretMax) {
        cost += (position.fret - style.preferredFretMax) * 0.35;
    }
    if (position.fret === 0) {
        cost -= 0.15;
    }
    return cost;
}

/** 两个相邻音之间的移动代价 */
function transitionCost(
    previous: FretPosition,
    next: FretPosition,
    playability: PlayabilityRules,
): number {
    const fretJump = Math.abs(next.fret - previous.fret);
    const stringJump = Math.abs(next.string - previous.string);

    let cost = fretJump + stringJump * 0.8;

    if (fretJump > playability.maxHandSpan) {
        cost += (fretJump - playability.maxHandSpan) * 5;
    }
    if (stringJump > playability.maxStringJump) {
        cost += (stringJump - playability.maxStringJump) * 3;
    }
    if (previous.string === next.string && previous.fret === next.fret) {
        cost += 0.6;
    }
    return cost;
}

/** 一个 voicing 的静态代价；单声部与旧实现完全相同 */
function voicingCost(
    positions: FretPosition[],
    style: StyleProfile,
): number {
    let cost = positions.reduce(
        (sum, position) => sum + positionCost(position, style),
        0,
    );
    if (positions.length > 1) {
        const frets = positions.map(position => position.fret);
        const strings = positions.map(position => position.string);
        cost += (Math.max(...frets) - Math.min(...frets)) * 0.05;
        cost += (Math.max(...strings) - Math.min(...strings)) * 0.1;
    }
    return cost;
}

/**
 * 两个 voicing 之间的移动代价。
 *
 * 多声部时，next 的每个声部取与 previous 各声部移动代价的最小值，再求和；
 * 单声部时严格退化为 `transitionCost`。
 */
function voicingTransitionCost(
    previous: FretPosition[],
    next: FretPosition[],
    playability: PlayabilityRules,
): number {
    if (previous.length === 1 && next.length === 1) {
        return transitionCost(previous[0], next[0], playability);
    }
    return next.reduce(
        (sum, nextPosition) => sum + Math.min(
            ...previous.map(previousPosition =>
                transitionCost(previousPosition, nextPosition, playability)),
        ),
        0,
    );
}

/**
 * 为骨架选把位。
 *
 * 发音 slot 的 `midis` 可以是单音，也可以是一组升序和弦音；休止必须为空。
 */
export function choosePositions(
    skeleton: SkeletonSlot[],
    options: ResolvedImprovOptions,
    playability: PlayabilityRules,
    style: StyleProfile,
): PositionedSlot[] {
    const noteIndices: number[] = [];
    const noteCandidates: FretPosition[][][] = [];
    const fretMin = options.fretRange?.min ?? playability.fretMin;
    const fretMax = options.fretRange?.max ?? playability.fretMax;

    skeleton.forEach((slot, index) => {
        if (slot.isRest) {
            if (slot.midis.length !== 0) {
                throw new Error(`休止 slot ${index} 不应有音高`);
            }
            return;
        }
        if (slot.midis.length === 0) {
            throw new Error(`发音 slot ${index} 缺少音高`);
        }
        if (slot.midis.length > playability.maxChordVoices) {
            throw new Error(
                `slot ${index} 声部过多: ${slot.midis.length} > ${playability.maxChordVoices}`,
            );
        }
        for (let i = 1; i < slot.midis.length; i++) {
            if (slot.midis[i] <= slot.midis[i - 1]) {
                throw new Error(`slot ${index} 的音高必须按升序排列`);
            }
        }

        const candidates = voicingCandidatesForMidis(
            options.tuning,
            slot.midis,
            fretMin,
            fretMax,
            playability,
        );
        if (candidates.length === 0) {
            if (slot.midis.length === 1) {
                throw new Error(`MIDI ${slot.midis[0]} 在指板上没有可用位置`);
            }
            throw new Error(
                `MIDI [${slot.midis.join(', ')}] 在指板上无法同时按出`,
            );
        }
        noteIndices.push(index);
        noteCandidates.push(candidates);
    });

    const positionsBySlot: FretPosition[][] = skeleton.map(() => []);
    if (noteIndices.length === 0) {
        return skeleton.map(slot => ({ skeleton: slot, positions: [] }));
    }

    const layers: State[][] = [];

    layers.push(noteCandidates[0].map(positions => ({
        positions,
        cost: voicingCost(positions, style),
        previous: -1,
    })));

    for (let noteIndex = 1; noteIndex < noteIndices.length; noteIndex++) {
        const previousLayer = layers[noteIndex - 1];
        const currentLayer = noteCandidates[noteIndex].map(positions => {
            let bestCost = Number.POSITIVE_INFINITY;
            let bestPrevious = -1;

            previousLayer.forEach((state, previousIndex) => {
                const cost = state.cost + voicingTransitionCost(
                    state.positions, positions, playability,
                );
                if (cost < bestCost) {
                    bestCost = cost;
                    bestPrevious = previousIndex;
                }
            });

            return {
                positions,
                cost: bestCost + voicingCost(positions, style),
                previous: bestPrevious,
            };
        });
        layers.push(currentLayer);
    }

    const lastLayer = layers[layers.length - 1];
    let bestIndex = 0;
    for (let index = 1; index < lastLayer.length; index++) {
        if (lastLayer[index].cost < lastLayer[bestIndex].cost) bestIndex = index;
    }

    const chosen: FretPosition[][] = new Array(noteIndices.length);
    let layerIndex = layers.length - 1;
    let stateIndex = bestIndex;
    while (layerIndex >= 0) {
        const state = layers[layerIndex][stateIndex];
        chosen[layerIndex] = state.positions;
        stateIndex = state.previous;
        layerIndex--;
    }

    chosen.forEach((positions, index) => {
        positionsBySlot[noteIndices[index]] = positions;
    });

    return skeleton.map((slot, index) => ({
        skeleton: slot,
        positions: positionsBySlot[index],
    }));
}
