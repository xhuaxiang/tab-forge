/**
 * positioning — 把位 DP 的候选映射、连贯性与边界测试。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type {
    LocalStyle,
    ScaleType,
    SkeletonSlot,
} from '../../../../core/types/improv.ts';
import { buildSkeleton } from '../../../../core/utils/improv/melody.ts';
import { choosePositions } from '../../../../core/utils/improv/positioning.ts';
import { buildRhythmPlan } from '../../../../core/utils/improv/rhythm.ts';
import { createRng } from '../../../../core/utils/improv/random.ts';
import { makeOptions } from './testOptions.ts';

function slot(
    midi: number,
    overrides: Partial<SkeletonSlot> = {},
): SkeletonSlot {
    return {
        measureIndex: 0,
        slotIndex: 0,
        duration: 0.25,
        isRest: false,
        midis: [midi],
        role: 'weak',
        ...overrides,
    };
}

interface Case {
    style: LocalStyle;
    scaleType: ScaleType;
    key: string;
}

const CASES: Case[] = [
    { style: 'Folk', scaleType: 'Major (Ionian)', key: 'C' },
    { style: 'Blues', scaleType: 'Blues', key: 'A' },
    { style: 'Rock', scaleType: 'Natural Minor (Aeolian)', key: 'E' },
    { style: 'Jazz', scaleType: 'Dorian', key: 'D' },
    { style: 'Classical', scaleType: 'Harmonic Minor', key: 'A' },
];

describe('choosePositions', () => {
    it('完整链路的每个音都落在合法指板位置且 MIDI 不变', () => {
        for (const caseItem of CASES) {
            for (let seed = 1; seed <= 5; seed++) {
                const options = makeOptions({
                    numMeasures: 4,
                    key: caseItem.key,
                    scaleType: caseItem.scaleType,
                    style: caseItem.style,
                    seed,
                });
                const style = LOCAL_IMPROV_CONFIG.styleProfiles[options.style];
                const rhythm = buildRhythmPlan(
                    options,
                    LOCAL_IMPROV_CONFIG.densityProfiles[options.density],
                    style,
                    createRng(seed),
                );
                const skeleton = buildSkeleton(
                    rhythm, options, style,
                    LOCAL_IMPROV_CONFIG.playability, createRng(seed + 100),
                );
                const positioned = choosePositions(
                    skeleton, options,
                    LOCAL_IMPROV_CONFIG.playability, style,
                );

                expect(positioned).toHaveLength(skeleton.length);
                positioned.forEach((item, index) => {
                    expect(item.skeleton).toBe(skeleton[index]);
                    const source = skeleton[index];
                    if (source.isRest) {
                        expect(item.positions).toEqual([]);
                        return;
                    }
                    expect(item.positions).toHaveLength(1);
                    const position = item.positions[0];
                    expect(position.midi).toBe(source.midis[0]);
                    expect(position.string).toBeGreaterThanOrEqual(1);
                    expect(position.string).toBeLessThanOrEqual(6);
                    expect(position.fret).toBeGreaterThanOrEqual(
                        LOCAL_IMPROV_CONFIG.playability.fretMin,
                    );
                    expect(position.fret).toBeLessThanOrEqual(
                        LOCAL_IMPROV_CONFIG.playability.fretMax,
                    );
                });
            }
        }
    });

    it('Folk 偏好低把位，连续音在相邻品位上完成', () => {
        const options = makeOptions({ style: 'Folk', seed: 1 });
        const style = LOCAL_IMPROV_CONFIG.styleProfiles.Folk;
        const positioned = choosePositions(
            [slot(64), slot(67), slot(65)],
            options, LOCAL_IMPROV_CONFIG.playability, style,
        );

        expect(positioned[0].positions[0]).toMatchObject({ string: 1, fret: 0 });
        expect(positioned[1].positions[0]).toMatchObject({ string: 1, fret: 3 });
        expect(positioned[2].positions[0].midi).toBe(65);
    });

    it('休止 slot 不参与 DP，位置保持空数组', () => {
        const options = makeOptions({ style: 'Folk' });
        const skeleton: SkeletonSlot[] = [
            slot(64),
            {
                measureIndex: 0,
                slotIndex: 1,
                duration: 0.25,
                isRest: true,
                midis: [],
                role: 'weak',
            },
            slot(67),
        ];
        const positioned = choosePositions(
            skeleton, options,
            LOCAL_IMPROV_CONFIG.playability,
            LOCAL_IMPROV_CONFIG.styleProfiles.Folk,
        );

        expect(positioned[1].positions).toEqual([]);
        expect(positioned[0].positions[0].midi).toBe(64);
        expect(positioned[2].positions[0].midi).toBe(67);
    });

    it('同输入结果完全一致', () => {
        const options = makeOptions({ style: 'Jazz' });
        const skeleton = [slot(60), slot(64), slot(67), slot(72)];
        const build = () => choosePositions(
            skeleton, options,
            LOCAL_IMPROV_CONFIG.playability,
            LOCAL_IMPROV_CONFIG.styleProfiles.Jazz,
        );
        expect(build()).toEqual(build());
    });

    it('无法在指板落位、多声部、休止带音高都会报错', () => {
        const options = makeOptions();
        const build = (skeleton: SkeletonSlot[]) => choosePositions(
            skeleton, options,
            LOCAL_IMPROV_CONFIG.playability,
            LOCAL_IMPROV_CONFIG.styleProfiles.Folk,
        );

        expect(() => build([slot(120)])).toThrow(/没有可用位置/);
        expect(() => build([slot(64, { midis: [64, 67] })]))
            .toThrow(/只支持单声部/);
        expect(() => build([{
            measureIndex: 0,
            slotIndex: 0,
            duration: 0.25,
            isRest: true,
            midis: [64],
            role: 'weak',
        }])).toThrow(/休止 slot/);
    });
});
