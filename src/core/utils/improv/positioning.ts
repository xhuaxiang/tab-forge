/**
 * positioning — 为旋律骨架选把位（Viterbi 动态规划，纯函数）。
 *
 * 同一个 MIDI 音在吉他上通常有多个 (弦, 品) 候选。DP 的代价同时考虑
 * 风格偏好把位、把位内品位跨度、跨弦距离与同音重复；结果对同一输入
 * 完全确定（候选按品位/弦号排序，平局取先出现的）。
 */

import type {
    FretPosition,
    PlayabilityRules,
    PositionedSlot,
    ResolvedImprovOptions,
    SkeletonSlot,
    StyleProfile,
} from '../../types/improv.ts';
import { midiToFretPositions } from './pitch.ts';

interface State {
    position: FretPosition;
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

/**
 * 为骨架选把位。
 *
 * v1 单声部：每个发音 slot 的 midis 长度必须为 0（休止）或 1。
 * 双音需要把状态扩成 voicing 元组，属于第二刀。
 */
export function choosePositions(
    skeleton: SkeletonSlot[],
    options: ResolvedImprovOptions,
    playability: PlayabilityRules,
    style: StyleProfile,
): PositionedSlot[] {
    const noteIndices: number[] = [];
    const noteCandidates: FretPosition[][] = [];

    skeleton.forEach((slot, index) => {
        if (slot.isRest) {
            if (slot.midis.length !== 0) {
                throw new Error(`休止 slot ${index} 不应有音高`);
            }
            return;
        }
        if (slot.midis.length !== 1) {
            throw new Error(`v1 只支持单声部，slot ${index} 有 ${slot.midis.length} 个音`);
        }

        const candidates = midiToFretPositions(
            options.tuning,
            slot.midis[0],
            playability.fretMin,
            playability.fretMax,
        );
        if (candidates.length === 0) {
            throw new Error(`MIDI ${slot.midis[0]} 在指板上没有可用位置`);
        }
        noteIndices.push(index);
        noteCandidates.push(candidates);
    });

    const positionsBySlot: FretPosition[][] = skeleton.map(() => []);
    if (noteIndices.length === 0) {
        return skeleton.map(slot => ({ skeleton: slot, positions: [] }));
    }

    const layers: State[][] = [];

    layers.push(noteCandidates[0].map(position => ({
        position,
        cost: positionCost(position, style),
        previous: -1,
    })));

    for (let noteIndex = 1; noteIndex < noteIndices.length; noteIndex++) {
        const previousLayer = layers[noteIndex - 1];
        const currentLayer = noteCandidates[noteIndex].map(position => {
            let bestCost = Number.POSITIVE_INFINITY;
            let bestPrevious = -1;

            previousLayer.forEach((state, previousIndex) => {
                const cost = state.cost + transitionCost(
                    state.position, position, playability,
                );
                if (cost < bestCost) {
                    bestCost = cost;
                    bestPrevious = previousIndex;
                }
            });

            return {
                position,
                cost: bestCost + positionCost(position, style),
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

    const chosen: FretPosition[] = new Array(noteIndices.length);
    let layerIndex = layers.length - 1;
    let stateIndex = bestIndex;
    while (layerIndex >= 0) {
        const state = layers[layerIndex][stateIndex];
        chosen[layerIndex] = state.position;
        stateIndex = state.previous;
        layerIndex--;
    }

    chosen.forEach((position, index) => {
        positionsBySlot[noteIndices[index]] = [position];
    });

    return skeleton.map((slot, index) => ({
        skeleton: slot,
        positions: positionsBySlot[index],
    }));
}
