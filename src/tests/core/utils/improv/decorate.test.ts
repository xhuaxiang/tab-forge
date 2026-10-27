/**
 * decorate — 演奏层白名单与确定性测试。
 *
 * 不跑完整生成链，直接构造已定位 slot，固定 rng 以便断言概率分支。
 */

import { describe, it, expect } from 'vitest';
import { BEND_AMOUNT_LABELS, LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type { NoteDuration } from '../../../../core/types/index.ts';
import type {
    PositionedSlot,
    SlotRole,
    StyleProfile,
} from '../../../../core/types/improv.ts';
import { decorateSlots } from '../../../../core/utils/improv/decorate.ts';
import { createRng } from '../../../../core/utils/improv/random.ts';

const PLAYABILITY = LOCAL_IMPROV_CONFIG.playability;
const BASE_STYLE = LOCAL_IMPROV_CONFIG.styleProfiles.Blues;

function style(overrides: Partial<StyleProfile> = {}): StyleProfile {
    return { ...BASE_STYLE, ...overrides };
}

function positioned(options: {
    duration?: NoteDuration;
    fret?: number;
    string?: number;
    role?: SlotRole;
    isRest?: boolean;
} = {}): PositionedSlot {
    const duration = options.duration ?? 0.5;
    const isRest = options.isRest ?? false;
    return {
        skeleton: {
            measureIndex: 0,
            slotIndex: 0,
            duration,
            isRest,
            midis: isRest ? [] : [60],
            role: options.role ?? 'weak',
        },
        positions: isRest
            ? []
            : [{
                string: options.string ?? 1,
                fret: options.fret ?? 5,
                midi: 60,
            }],
    };
}

/** 固定值的 rng：用于让概率分支必然走某一边 */
function constantRng(value: number): () => number {
    return () => value;
}

describe('decorateSlots', () => {
    it('休止符只保留 isRest 与 duration', () => {
        const [rest] = decorateSlots(
            [positioned({ isRest: true, duration: 0.25 })],
            style(), PLAYABILITY, constantRng(0),
        );
        expect(rest).toEqual({ isRest: true, duration: 0.25 });
    });

    it('强拍走 accent、弱拍/经过音走 soft 分支', () => {
        const loudStyle = style({
            accentProbability: 1,
            softProbability: 1,
            bendProbability: 0,
            vibratoProbability: 0,
            palmMuteProbability: 0,
        });
        const [strong, weak, passing] = decorateSlots(
            [
                positioned({ role: 'strong' }),
                positioned({ role: 'weak' }),
                positioned({ role: 'passing' }),
            ],
            loudStyle, PLAYABILITY, constantRng(0),
        );
        expect(strong.dynamics).toBe('accent');
        expect(weak.dynamics).toBe('soft');
        expect(passing.dynamics).toBe('soft');
    });

    it('概率为 0 时不写 dynamics', () => {
        const [note] = decorateSlots(
            [positioned({ role: 'strong' })],
            style({
                accentProbability: 0,
                softProbability: 0,
                bendProbability: 0,
                vibratoProbability: 0,
                palmMuteProbability: 0,
            }),
            PLAYABILITY, constantRng(0),
        );
        expect(note.dynamics).toBeUndefined();
    });

    it('推弦只给按弦音，且可带释放', () => {
        const [bent] = decorateSlots(
            [positioned({ duration: 0.5, fret: 5 })],
            style({
                accentProbability: 0,
                softProbability: 0,
                bendProbability: 1,
                vibratoProbability: 0,
                palmMuteProbability: 0,
            }),
            PLAYABILITY, constantRng(0),
        );
        expect(bent.technique).toBe('bend');
        expect(Object.keys(BEND_AMOUNT_LABELS).map(Number))
            .toContain(bent.bendAmount);
        expect(bent.bendRelease).toBe(true);
    });

    it('空弦与过短时值不推弦/揉弦', () => {
        const openString = decorateSlots(
            [positioned({ fret: 0 })],
            style({ accentProbability: 0, softProbability: 0, bendProbability: 1, vibratoProbability: 1 }),
            PLAYABILITY, constantRng(0),
        )[0];
        expect(openString.technique).toBeUndefined();

        const tooShort = decorateSlots(
            [positioned({ duration: 0.0625, fret: 5 })],
            style({ accentProbability: 0, softProbability: 0, bendProbability: 1, vibratoProbability: 1 }),
            PLAYABILITY, constantRng(0),
        )[0];
        expect(tooShort.technique).toBeUndefined();
    });

    it('揉弦遵守最短时值', () => {
        const articulationsOff = style({
            accentProbability: 0,
            softProbability: 0,
            bendProbability: 0,
            vibratoProbability: 1,
            palmMuteProbability: 0,
        });
        const [tooShort] = decorateSlots(
            [positioned({ duration: 0.125, fret: 5 })],
            articulationsOff, PLAYABILITY, constantRng(0),
        );
        expect(tooShort.technique).toBeUndefined();

        const [longEnough] = decorateSlots(
            [positioned({ duration: 0.25, fret: 5 })],
            articulationsOff, PLAYABILITY, constantRng(0),
        );
        expect(longEnough.technique).toBe('vibrato');
    });

    it('手掌闷音只看 4-6 弦且遵守最短时值', () => {
        const palmMuteStyle = style({
            accentProbability: 0,
            softProbability: 0,
            bendProbability: 0,
            vibratoProbability: 0,
            palmMuteProbability: 1,
        });
        const [lowString] = decorateSlots(
            [positioned({ duration: 0.125, string: 4 })],
            palmMuteStyle, PLAYABILITY, constantRng(0),
        );
        expect(lowString.palmMute).toBe(true);

        const [highString] = decorateSlots(
            [positioned({ duration: 0.5, string: 3 })],
            palmMuteStyle, PLAYABILITY, constantRng(0),
        );
        expect(highString.palmMute).toBeUndefined();

        const [tooShort] = decorateSlots(
            [positioned({ duration: 0.0625, string: 6 })],
            palmMuteStyle, PLAYABILITY, constantRng(0),
        );
        expect(tooShort.palmMute).toBeUndefined();
    });

    it('technique 与 palmMute 互斥，优先级为 bend → vibrato → palmMute', () => {
        const allOn = style({
            accentProbability: 0,
            softProbability: 0,
            bendProbability: 1,
            vibratoProbability: 1,
            palmMuteProbability: 1,
        });
        const [bent] = decorateSlots(
            [positioned({ duration: 0.5, string: 6 })],
            allOn, PLAYABILITY, constantRng(0),
        );
        expect(bent.technique).toBe('bend');
        expect(bent.palmMute).toBeUndefined();

        const [vibrato] = decorateSlots(
            [positioned({ duration: 0.5, string: 6 })],
            { ...allOn, bendProbability: 0 },
            PLAYABILITY, constantRng(0),
        );
        expect(vibrato.technique).toBe('vibrato');
        expect(vibrato.palmMute).toBeUndefined();
    });

    it('同 seed 完全一致', () => {
        const build = () => {
            const rng = createRng(42);
            return decorateSlots(
                [
                    positioned({ role: 'strong' }),
                    positioned({ role: 'weak', duration: 0.25 }),
                    positioned({ role: 'passing', duration: 0.0625 }),
                    positioned({ isRest: true }),
                ],
                BASE_STYLE, PLAYABILITY, rng,
            );
        };
        expect(build()).toEqual(build());
    });
});
