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
    // 旧用例只关心技法/力度/闷音，默认关掉新增奏法，避免 Blues 默认概率
    // 抢先命中某个分支导致断言失焦。
    return {
        ...BASE_STYLE,
        deadNoteProbability: 0,
        staccatoProbability: 0,
        letRingProbability: 0,
        harmonicProbability: 0,
        chordProbability: 0,
        arpeggioProbability: 0,
        strumProbability: 0,
        ...overrides,
    };
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

interface ChordMember {
    string: number;
    fret: number;
    midi: number;
}

/** 构造一个多声部拍位；midis 与 positions 一一对应且升序 */
function chordPositioned(options: {
    members: ChordMember[];
    duration?: NoteDuration;
    role?: SlotRole;
}): PositionedSlot {
    return {
        skeleton: {
            measureIndex: 0,
            slotIndex: 0,
            duration: options.duration ?? 0.5,
            isRest: false,
            midis: options.members.map(member => member.midi),
            role: options.role ?? 'strong',
        },
        positions: options.members.map(member => ({ ...member })),
    };
}

/** 两音/三音和弦组的固定成员，音高升序 */
const CHORD_TWO: ChordMember[] = [
    { string: 2, fret: 1, midi: 60 },
    { string: 1, fret: 0, midi: 64 },
];
const CHORD_THREE: ChordMember[] = [
    { string: 3, fret: 0, midi: 55 },
    { string: 2, fret: 1, midi: 60 },
    { string: 1, fret: 0, midi: 64 },
];

/** 关掉技法与旧概率分支，只剩被测奏法 */
function articulationStyle(overrides: Partial<StyleProfile> = {}): StyleProfile {
    return style({
        accentProbability: 0,
        softProbability: 0,
        bendProbability: 0,
        vibratoProbability: 0,
        palmMuteProbability: 0,
        hammerPullProbability: 0,
        slideProbability: 0,
        ...overrides,
    });
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

    it('同弦相邻音按跨度标击弦/勾弦', () => {
        const connectStyle = style({
            accentProbability: 0,
            softProbability: 0,
            bendProbability: 0,
            vibratoProbability: 0,
            palmMuteProbability: 0,
            hammerPullProbability: 1,
            slideProbability: 0,
        });
        const [up, hammer] = decorateSlots(
            [
                positioned({ fret: 5, duration: 0.25 }),
                positioned({ fret: 7, duration: 0.25 }),
            ],
            connectStyle, PLAYABILITY, constantRng(0),
        );
        expect(up.technique).toBeUndefined();
        expect(hammer.technique).toBe('hammerOn');

        const [, pull] = decorateSlots(
            [
                positioned({ fret: 7, duration: 0.25 }),
                positioned({ fret: 5, duration: 0.25 }),
            ],
            connectStyle, PLAYABILITY, constantRng(0),
        );
        expect(pull.technique).toBe('pullOff');
    });

    it('换把跨度大于击勾弦上限时标滑弦', () => {
        const slideStyle = style({
            accentProbability: 0,
            softProbability: 0,
            bendProbability: 0,
            vibratoProbability: 0,
            palmMuteProbability: 0,
            hammerPullProbability: 1,
            slideProbability: 1,
        });
        const [, slide] = decorateSlots(
            [
                positioned({ fret: 5, duration: 0.25 }),
                positioned({ fret: 9, duration: 0.25 }),
            ],
            slideStyle, PLAYABILITY, constantRng(0),
        );
        expect(slide.technique).toBe('slide');
    });

    it('短跨度可标滑弦，但两端不能是空弦或超过跨度上限', () => {
        const onlySlide = style({
            accentProbability: 0,
            softProbability: 0,
            bendProbability: 0,
            vibratoProbability: 0,
            palmMuteProbability: 0,
            hammerPullProbability: 0,
            slideProbability: 1,
        });
        const [, shortSpan] = decorateSlots(
            [
                positioned({ fret: 5, duration: 0.25 }),
                positioned({ fret: 7, duration: 0.25 }),
            ],
            onlySlide, PLAYABILITY, constantRng(0),
        );
        expect(shortSpan.technique).toBe('slide');

        const [, fromOpen] = decorateSlots(
            [
                positioned({ fret: 0, duration: 0.25 }),
                positioned({ fret: 5, duration: 0.25 }),
            ],
            onlySlide, PLAYABILITY, constantRng(0),
        );
        expect(fromOpen.technique).toBeUndefined();

        const [, toOpen] = decorateSlots(
            [
                positioned({ fret: 5, duration: 0.25 }),
                positioned({ fret: 0, duration: 0.25 }),
            ],
            onlySlide, PLAYABILITY, constantRng(0),
        );
        expect(toOpen.technique).toBeUndefined();

        const [, tooFar] = decorateSlots(
            [
                positioned({ fret: 2, duration: 0.25 }),
                positioned({ fret: 12, duration: 0.25 }),
            ],
            onlySlide, PLAYABILITY, constantRng(0),
        );
        expect(tooFar.technique).toBeUndefined();
    });

    it('连接目标不写 dynamics（复用的是源音缓冲）', () => {
        const accentConnect = style({
            accentProbability: 1,
            softProbability: 0,
            bendProbability: 0,
            vibratoProbability: 0,
            palmMuteProbability: 0,
            hammerPullProbability: 1,
            slideProbability: 0,
        });
        const [source, target] = decorateSlots(
            [
                positioned({ role: 'strong', fret: 5, duration: 0.25 }),
                positioned({ role: 'strong', fret: 7, duration: 0.25 }),
            ],
            accentConnect, PLAYABILITY, constantRng(0),
        );
        expect(source.dynamics).toBe('accent');
        expect(target.technique).toBe('hammerOn');
        expect(target.dynamics).toBeUndefined();
    });

    it('换弦、休止、前音闷音或时值过短时不连奏', () => {
        const connectStyle = style({
            accentProbability: 0,
            softProbability: 0,
            bendProbability: 0,
            vibratoProbability: 0,
            palmMuteProbability: 0,
            hammerPullProbability: 1,
            slideProbability: 1,
        });
        const [, otherString] = decorateSlots(
            [
                positioned({ fret: 5, string: 1, duration: 0.25 }),
                positioned({ fret: 7, string: 2, duration: 0.25 }),
            ],
            connectStyle, PLAYABILITY, constantRng(0),
        );
        expect(otherString.technique).toBeUndefined();

        const [, afterRest] = decorateSlots(
            [
                positioned({ fret: 5, duration: 0.25 }),
                positioned({ isRest: true, duration: 0.25 }),
                positioned({ fret: 7, duration: 0.25 }),
            ],
            connectStyle, PLAYABILITY, constantRng(0),
        );
        expect(afterRest.technique).toBeUndefined();

        const [, tooShort] = decorateSlots(
            [
                positioned({ fret: 5, duration: 0.25 }),
                positioned({ fret: 7, duration: 0.03125 }),
            ],
            connectStyle, PLAYABILITY, constantRng(0),
        );
        expect(tooShort.technique).toBeUndefined();

        const palmStyle = style({ ...connectStyle, palmMuteProbability: 1 });
        const [, mutedSource] = decorateSlots(
            [
                positioned({ fret: 5, string: 6, duration: 0.25 }),
                positioned({ fret: 7, string: 6, duration: 0.25 }),
            ],
            palmStyle, PLAYABILITY, constantRng(0),
        );
        expect(mutedSource.technique).toBeUndefined();
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
        // 每个用例都补一个尾音：被断言的音不能是收尾音，否则会被终止式豁免
        const tail = positioned({ duration: 0.5, string: 1, fret: 7 });
        const [lowString] = decorateSlots(
            [positioned({ duration: 0.125, string: 4 }), tail],
            palmMuteStyle, PLAYABILITY, constantRng(0),
        );
        expect(lowString.palmMute).toBe(true);

        const [highString] = decorateSlots(
            [positioned({ duration: 0.5, string: 3 }), tail],
            palmMuteStyle, PLAYABILITY, constantRng(0),
        );
        expect(highString.palmMute).toBeUndefined();

        const [tooShort] = decorateSlots(
            [positioned({ duration: 0.0625, string: 6 }), tail],
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

    it('和弦组：同组同时值同力度，组首独占扫弦，组内不叠加单音奏法', () => {
        const allOn = articulationStyle({
            accentProbability: 1,
            softProbability: 0,
            deadNoteProbability: 1,
            staccatoProbability: 1,
            letRingProbability: 1,
            harmonicProbability: 1,
            palmMuteProbability: 1,
            strumProbability: 1,
            arpeggioProbability: 1,
        });

        const two = decorateSlots(
            [chordPositioned({ members: CHORD_TWO })],
            allOn, PLAYABILITY, constantRng(0),
        );
        expect(two).toHaveLength(2);
        expect(two[0].chordGroup).toBe(1);
        expect(two[1].chordGroup).toBe(1);
        for (const note of two) {
            expect(note.duration).toBe(0.5);
            expect(note.dynamics).toBe('accent');
            expect(note.technique).toBeUndefined();
            expect(note.deadNote).toBeUndefined();
            expect(note.palmMute).toBeUndefined();
            expect(note.letRing).toBeUndefined();
            expect(note.staccato).toBeUndefined();
            expect(note.harmonic).toBeUndefined();
            expect(note.harmonicFret).toBeUndefined();
        }
        // 扫弦优先于琶音，且只写在组首
        expect(two[0].strum).toBe('down');
        expect(two[0].arpeggio).toBeUndefined();
        expect(two[1].strum).toBeUndefined();
        expect(two[1].arpeggio).toBeUndefined();

        const three = decorateSlots(
            [chordPositioned({ members: CHORD_THREE })],
            allOn, PLAYABILITY, constantRng(0),
        );
        expect(three).toHaveLength(3);
        expect(new Set(three.map(note => note.chordGroup))).toEqual(new Set([1]));
        expect(three.every(note => note.duration === 0.5)).toBe(true);
        expect(three.every(note => note.dynamics === 'accent')).toBe(true);
        expect(three[0].strum).toBe('down');
        expect(three.slice(1).every(note => note.strum === undefined)).toBe(true);
    });

    it('和弦组：概率为 0 不写 strum/arpeggio，单开琶音时只写组首', () => {
        const quiet = decorateSlots(
            [chordPositioned({ members: CHORD_TWO })],
            style(), PLAYABILITY, constantRng(0),
        );
        expect(quiet.every(note => note.strum === undefined
            && note.arpeggio === undefined)).toBe(true);

        const arpeggioOnly = decorateSlots(
            [chordPositioned({ members: CHORD_TWO })],
            style({ arpeggioProbability: 1, strumProbability: 0 }),
            PLAYABILITY, constantRng(0),
        );
        expect(arpeggioOnly[0].arpeggio).toBe('down');
        expect(arpeggioOnly[0].strum).toBeUndefined();
        expect(arpeggioOnly[1].arpeggio).toBeUndefined();
    });

    it('和弦组后 previous 重置，下一单音不会从组内音连接', () => {
        const connectStyle = articulationStyle({
            hammerPullProbability: 1,
            slideProbability: 0,
        });
        const [, next] = decorateSlots(
            [
                chordPositioned({
                    members: [
                        { string: 1, fret: 5, midi: 60 },
                        { string: 2, fret: 7, midi: 64 },
                    ],
                    duration: 0.25,
                }),
                positioned({ string: 1, fret: 7, duration: 0.25 }),
            ],
            connectStyle, PLAYABILITY, constantRng(0),
        );
        expect(next.technique).toBeUndefined();
    });

    it('制音只标低音弦，且最后一个发音不标', () => {
        const deadStyle = articulationStyle({ deadNoteProbability: 1 });

        const [first, last] = decorateSlots(
            [
                positioned({ string: 6, fret: 5, duration: 0.25 }),
                positioned({ string: 6, fret: 7, duration: 0.25 }),
            ],
            deadStyle, PLAYABILITY, constantRng(0),
        );
        expect(first.string).toBe(6);
        expect(first.duration).toBe(0.25);
        expect(first.deadNote).toBe(true);
        expect(last.deadNote).toBeUndefined();

        const [high] = decorateSlots(
            [
                positioned({ string: 1, fret: 5, duration: 0.25 }),
                positioned({ string: 6, fret: 7, duration: 0.25 }),
            ],
            deadStyle, PLAYABILITY, constantRng(0),
        );
        expect(high.deadNote).toBeUndefined();

        const [tooShort] = decorateSlots(
            [
                positioned({ string: 6, fret: 5, duration: 0.0625 }),
                positioned({ string: 6, fret: 7, duration: 0.25 }),
            ],
            deadStyle, PLAYABILITY, constantRng(0),
        );
        expect(tooShort.deadNote).toBeUndefined();
    });

    it('自然泛音写在节点品上且不写 harmonicFret', () => {
        const [note] = decorateSlots(
            [positioned({ string: 1, fret: 12, duration: 0.25 })],
            articulationStyle({ harmonicProbability: 1 }),
            PLAYABILITY, constantRng(0),
        );
        expect(note.harmonic).toBe('natural');
        expect(note.harmonicFret).toBeUndefined();
    });

    it('人工/捏弦泛音写 harmonicFret，且按可用性选择类型', () => {
        const [artificial] = decorateSlots(
            [positioned({ string: 1, fret: 5, duration: 0.25 })],
            articulationStyle({ harmonicProbability: 1 }),
            PLAYABILITY, constantRng(0),
        );
        expect(artificial.harmonic).toBe('artificial');
        expect(artificial.harmonicFret).toBe(12);

        const [pinch] = decorateSlots(
            [positioned({ string: 5, fret: 5, duration: 0.25 })],
            articulationStyle({ harmonicProbability: 1 }),
            PLAYABILITY, constantRng(0),
        );
        expect(pinch.harmonic).toBe('pinch');
        expect(pinch.harmonicFret).toBe(12);
    });

    it('泛音遵守最短时值与弦号/品位可用性', () => {
        const harmonicStyle = articulationStyle({ harmonicProbability: 1 });

        const [tooShort] = decorateSlots(
            [positioned({ string: 1, fret: 12, duration: 0.125 })],
            harmonicStyle, PLAYABILITY, constantRng(0),
        );
        expect(tooShort.harmonic).toBeUndefined();

        // 空弦没有按弦品位，人工泛音不可用
        const [openString] = decorateSlots(
            [positioned({ string: 1, fret: 0, duration: 0.25 })],
            harmonicStyle, PLAYABILITY, constantRng(0),
        );
        expect(openString.harmonic).toBeUndefined();
    });

    it('断音与延音按概率写入，概率 0 不写字段', () => {
        const [staccato] = decorateSlots(
            [
                positioned({ string: 1, fret: 5, duration: 0.125 }),
                positioned({ string: 1, fret: 7, duration: 0.5 }),
            ],
            articulationStyle({ staccatoProbability: 1 }),
            PLAYABILITY, constantRng(0),
        );
        expect(staccato.staccato).toBe(true);

        const [letRing] = decorateSlots(
            [positioned({ string: 1, fret: 5, duration: 0.25 })],
            articulationStyle({ letRingProbability: 1 }),
            PLAYABILITY, constantRng(0),
        );
        expect(letRing.letRing).toBe(true);

        const [quiet] = decorateSlots(
            [
                positioned({ string: 5, fret: 5, duration: 0.5 }),
                positioned({ string: 1, fret: 7, duration: 0.5 }),
            ],
            articulationStyle(), PLAYABILITY, constantRng(0),
        );
        expect(quiet.technique).toBeUndefined();
        expect(quiet.deadNote).toBeUndefined();
        expect(quiet.harmonic).toBeUndefined();
        expect(quiet.harmonicFret).toBeUndefined();
        expect(quiet.staccato).toBeUndefined();
        expect(quiet.letRing).toBeUndefined();
        expect(quiet.palmMute).toBeUndefined();
    });

    it('收尾音不写断音/闷音/制音，即使概率为 1', () => {
        // 终止音要保持完整衰减；前一个音仍照常命中，证明只是收尾豁免。
        const chokeStyle = articulationStyle({
            deadNoteProbability: 1,
            staccatoProbability: 1,
            palmMuteProbability: 1,
        });
        const [first, last] = decorateSlots(
            [
                positioned({ string: 6, fret: 5, duration: 0.25 }),
                positioned({ string: 6, fret: 7, duration: 0.5 }),
            ],
            chokeStyle, PLAYABILITY, constantRng(0),
        );
        expect(first.deadNote).toBe(true);
        expect(last.staccato).toBeUndefined();
        expect(last.palmMute).toBeUndefined();
        expect(last.deadNote).toBeUndefined();
    });

    it('把位数量或 MIDI 与骨架不一致时抛错', () => {
        const countMismatch: PositionedSlot = {
            skeleton: {
                measureIndex: 0,
                slotIndex: 0,
                duration: 0.5,
                isRest: false,
                midis: [60, 64],
                role: 'strong',
            },
            positions: [{ string: 1, fret: 5, midi: 60 }],
        };
        expect(() => decorateSlots(
            [countMismatch], style(), PLAYABILITY, constantRng(0),
        )).toThrow('把位数量与音高数量不一致');

        const midiMismatch: PositionedSlot = {
            skeleton: {
                measureIndex: 0,
                slotIndex: 0,
                duration: 0.5,
                isRest: false,
                midis: [60, 64],
                role: 'strong',
            },
            positions: [
                { string: 1, fret: 5, midi: 60 },
                { string: 2, fret: 5, midi: 67 },
            ],
        };
        expect(() => decorateSlots(
            [midiMismatch], style(), PLAYABILITY, constantRng(0),
        )).toThrow('把位音高与骨架音高不一致');
    });

    it('新增奏法概率为 0 时不消耗额外随机数', () => {
        let calls = 0;
        const rng = () => {
            calls++;
            return 0.99;
        };
        decorateSlots(
            [positioned({ duration: 0.5, string: 6, fret: 5 })],
            style({
                accentProbability: 0,
                softProbability: 0,
                bendProbability: 0,
                vibratoProbability: 0,
                palmMuteProbability: 0,
                hammerPullProbability: 0,
                slideProbability: 0,
            }),
            PLAYABILITY, rng,
        );
        // 旧分支 bend / vibrato / palmMute 各掷一次、dynamics 一次；
        // deadNote/harmonic/staccato/letRing 在概率 0 时必须在 rng 前短路。
        expect(calls).toBe(4);
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
