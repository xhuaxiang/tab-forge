import { describe, it, expect } from 'vitest';
import type { Note } from '../../../core/types/index.ts';
import {
    canSourceTechnique,
    followTargetFret,
    isConnectingTarget,
    isConnectingTechnique,
    resolveSoundingFret,
} from '../../../core/utils/technique.ts';

function note(partial: Partial<Note> = {}): Note {
    return { string: 1, fret: 0, duration: 0.25, ...partial };
}

describe('isConnectingTechnique', () => {
    it('击弦/勾弦/滑弦属于连接类技法', () => {
        expect(isConnectingTechnique('hammerOn')).toBe(true);
        expect(isConnectingTechnique('pullOff')).toBe(true);
        expect(isConnectingTechnique('slide')).toBe(true);
    });

    it('推弦/揉弦是自身拨弦的技法，不算连接类', () => {
        expect(isConnectingTechnique('bend')).toBe(false);
        expect(isConnectingTechnique('vibrato')).toBe(false);
    });

    it('无技法或未知值返回 false', () => {
        expect(isConnectingTechnique(undefined)).toBe(false);
        expect(isConnectingTechnique(null as unknown as undefined)).toBe(false);
    });
});

describe('resolveSoundingFret', () => {
    it('H/P/S 落在目标品（到达音）上，而非表单里的起点品', () => {
        for (const technique of ['hammerOn', 'pullOff', 'slide'] as const) {
            expect(resolveSoundingFret(5, technique, 7)).toBe(7);
        }
    });

    it('推弦/揉弦/无技法不读目标品', () => {
        expect(resolveSoundingFret(5, 'bend', 7)).toBe(5);
        expect(resolveSoundingFret(5, 'vibrato', 7)).toBe(5);
        expect(resolveSoundingFret(5, undefined, 7)).toBe(5);
    });

    it('目标品缺失时回退到原品', () => {
        expect(resolveSoundingFret(5, 'hammerOn', undefined)).toBe(5);
    });

    it('目标品等于原品时保持原值', () => {
        expect(resolveSoundingFret(7, 'pullOff', 7)).toBe(7);
    });
});

describe('followTargetFret', () => {
    it('目标品还停在旧品上（未被显式改过）时跟着新品质走', () => {
        for (const technique of ['hammerOn', 'pullOff', 'slide'] as const) {
            expect(followTargetFret(7, 5, 5, technique)).toBe(7);
        }
    });

    it('用户显式改过目标品后不再覆盖', () => {
        expect(followTargetFret(7, 5, 9, 'hammerOn')).toBe(9);
    });

    it('非连接类技法不读目标品', () => {
        expect(followTargetFret(7, 5, 5, 'bend')).toBe(5);
        expect(followTargetFret(7, 5, 5, 'none')).toBe(5);
        expect(followTargetFret(7, 5, 5, undefined)).toBe(5);
    });
});

describe('isConnectingTarget', () => {
    it('普通击/勾/滑目标可以复用源音', () => {
        expect(isConnectingTarget(note({ technique: 'hammerOn' }))).toBe(true);
        expect(isConnectingTarget(note({ technique: 'slide' }))).toBe(true);
    });

    it('死音/泛音目标必须重新拨弦', () => {
        expect(isConnectingTarget(note({ technique: 'hammerOn', deadNote: true }))).toBe(false);
        expect(isConnectingTarget(note({ technique: 'pullOff', harmonic: 'natural' }))).toBe(false);
    });

    it('推弦/揉弦不是连接类目标', () => {
        expect(isConnectingTarget(note({ technique: 'bend' }))).toBe(false);
        expect(isConnectingTarget(note())).toBe(false);
    });
});

describe('canSourceTechnique', () => {
    it('普通音与泛音可作为源音', () => {
        expect(canSourceTechnique(note())).toBe(true);
        expect(canSourceTechnique(note({ harmonic: 'natural' }))).toBe(true);
    });

    it('palmMute / 死音 / 断音不能作为源音', () => {
        expect(canSourceTechnique(note({ palmMute: true }))).toBe(false);
        expect(canSourceTechnique(note({ deadNote: true }))).toBe(false);
        // 断音被有意缩短时值，不能被 ring 拉长
        expect(canSourceTechnique(note({ staccato: true }))).toBe(false);
    });
});
