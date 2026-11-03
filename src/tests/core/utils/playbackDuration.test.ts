/**
 * resolvePlayDuration — 记谱时值 + 奏法开关 → 实际发声时长
 */

import { describe, it, expect } from 'vitest';
import type { Note } from '../../../core/types/index.ts';
import { resolvePlayDuration } from '../../../core/utils/playbackDuration.ts';
import { KARPLUS_ARTICULATION } from '../../../core/config.ts';

function note(partial: Partial<Note> = {}): Note {
    return { string: 1, fret: 0, duration: 0.25, ...partial };
}

describe('resolvePlayDuration', () => {
    it('普通音原样返回记谱时值', () => {
        expect(resolvePlayDuration(note(), 0.5)).toBeCloseTo(0.5, 5);
    });

    it('断音按时值系数缩短，自由延音追加固定时长', () => {
        expect(resolvePlayDuration(note({ staccato: true }), 0.5))
            .toBeCloseTo(0.5 * KARPLUS_ARTICULATION.staccatoDurationFactor, 5);
        expect(resolvePlayDuration(note({ letRing: true }), 0.5))
            .toBeCloseTo(0.5 + KARPLUS_ARTICULATION.letRingExtraSec, 5);
    });

    it('断音优先于自由延音，两者同时开不被额外延长抵消', () => {
        expect(resolvePlayDuration(note({ staccato: true, letRing: true }), 0.5))
            .toBeCloseTo(0.5 * KARPLUS_ARTICULATION.staccatoDurationFactor, 5);
    });

    it('手掌闷音与制音各自取上限，制音更短', () => {
        expect(resolvePlayDuration(note({ palmMute: true }), 2))
            .toBeCloseTo(KARPLUS_ARTICULATION.palmMuteMaxSec, 5);
        expect(resolvePlayDuration(note({ deadNote: true }), 2))
            .toBeCloseTo(KARPLUS_ARTICULATION.deadNoteMaxSec, 5);
        expect(resolvePlayDuration(note({ palmMute: true, deadNote: true }), 2))
            .toBeCloseTo(KARPLUS_ARTICULATION.deadNoteMaxSec, 5);
    });
});
