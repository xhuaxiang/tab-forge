/**
 * practice — 练习意图 → 风格参数的缩放测试。
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_IMPROV_CONFIG } from '../../../../core/config.ts';
import type {
    PracticeFocus,
    PracticeProfile,
    StyleProfile,
} from '../../../../core/types/improv/index.ts';
import { applyPracticeProfile } from '../../../../core/utils/improv/practice.ts';

const PROFILES = LOCAL_IMPROV_CONFIG.practiceProfiles;
const ROCK = LOCAL_IMPROV_CONFIG.styleProfiles.Rock;
const JAZZ = LOCAL_IMPROV_CONFIG.styleProfiles.Jazz;
const FOLK = LOCAL_IMPROV_CONFIG.styleProfiles.Folk;

function snapshot(style: StyleProfile): StyleProfile {
    return JSON.parse(JSON.stringify(style)) as StyleProfile;
}

function customProfiles(
    practice: PracticeFocus,
    profile: PracticeProfile,
): Record<PracticeFocus, PracticeProfile> {
    return { ...PROFILES, [practice]: profile };
}

describe('applyPracticeProfile', () => {
    it('none 返回与原风格等值的新对象', () => {
        const next = applyPracticeProfile(ROCK, 'none', PROFILES);
        expect(next).toEqual(ROCK);
        expect(next).not.toBe(ROCK);
        expect(next.phrase).not.toBe(ROCK.phrase);
    });

    it('fretboard 按 expressionScale=0.25 缩放 13 项表情概率', () => {
        const next = applyPracticeProfile(ROCK, 'fretboard', PROFILES);
        expect(next.bendProbability).toBeCloseTo(0.03, 12);
        expect(next.vibratoProbability).toBeCloseTo(0.025, 12);
        expect(next.palmMuteProbability).toBeCloseTo(0.0625, 12);
        expect(next.hammerPullProbability).toBeCloseTo(0.045, 12);
        expect(next.slideProbability).toBeCloseTo(0.02, 12);
        expect(next.deadNoteProbability).toBeCloseTo(0.02, 12);
        expect(next.staccatoProbability).toBeCloseTo(0.025, 12);
        expect(next.letRingProbability).toBeCloseTo(0.025, 12);
        expect(next.harmonicProbability).toBeCloseTo(0.015, 12);
        expect(next.chordProbability).toBeCloseTo(0.045, 12);
        expect(next.secondVoicingProbability).toBeCloseTo(0.125, 12);
        expect(next.arpeggioProbability).toBeCloseTo(0.025, 12);
        expect(next.strumProbability).toBeCloseTo(0.075, 12);
    });

    it('fretboard 收紧 maxLeap 并把句间换把概率置 0', () => {
        const next = applyPracticeProfile(ROCK, 'fretboard', PROFILES);
        expect(next.maxLeapSemitones).toBe(3);
        expect(next.phrase.shiftProbability).toBe(0);
    });

    it('fretboard 不改动基本律动、结构与时值/音区/把位参数', () => {
        const next = applyPracticeProfile(ROCK, 'fretboard', PROFILES);
        expect(next.accentProbability).toBe(ROCK.accentProbability);
        expect(next.softProbability).toBe(ROCK.softProbability);
        expect(next.repetitionProbability).toBe(ROCK.repetitionProbability);
        expect(next.naturalHarmonicShare).toBe(ROCK.naturalHarmonicShare);
        expect(next.pinchHarmonicShare).toBe(ROCK.pinchHarmonicShare);
        expect(next.durations).toEqual(ROCK.durations);
        expect(next.registerCenterMidi).toBe(ROCK.registerCenterMidi);
        expect(next.registerRangeSemitones).toBe(ROCK.registerRangeSemitones);
        expect(next.preferredFretMin).toBe(ROCK.preferredFretMin);
        expect(next.preferredFretMax).toBe(ROCK.preferredFretMax);
        expect(next.motifLength).toBe(ROCK.motifLength);
        expect(next.phrase.endRestProbability)
            .toBe(ROCK.phrase.endRestProbability);
        expect(next.phrase.shiftFrets).toBe(ROCK.phrase.shiftFrets);
    });

    it('technique 概率与 maxLeap 都保持原值（预设上限为 null）', () => {
        const next = applyPracticeProfile(ROCK, 'technique', PROFILES);
        expect(next).toEqual(ROCK);
        expect(next.maxLeapSemitones).toBe(ROCK.maxLeapSemitones);
    });

    it('预设上限高于风格值时只收紧不放大', () => {
        const profiles = customProfiles('technique', {
            expressionScale: 0.5,
            maxLeapSemitones: 99,
            keepPosition: false,
        });
        const next = applyPracticeProfile(ROCK, 'technique', profiles);
        expect(next.maxLeapSemitones).toBe(ROCK.maxLeapSemitones);
        expect(next.bendProbability)
            .toBeCloseTo(ROCK.bendProbability * 0.5, 12);
    });

    it('0 概率缩放后仍为 0', () => {
        expect(applyPracticeProfile(JAZZ, 'fretboard', PROFILES)
            .palmMuteProbability).toBe(0);
        const folk = applyPracticeProfile(FOLK, 'fretboard', PROFILES);
        expect(folk.bendProbability).toBe(0);
        expect(folk.deadNoteProbability).toBe(0);
    });

    it('不修改入参', () => {
        const before = snapshot(ROCK);
        applyPracticeProfile(ROCK, 'fretboard', PROFILES);
        expect(ROCK).toEqual(before);
    });

    it('返回的对象与 phrase 都是新引用', () => {
        const next = applyPracticeProfile(ROCK, 'fretboard', PROFILES);
        expect(next).not.toBe(ROCK);
        expect(next.phrase).not.toBe(ROCK.phrase);
    });
});
