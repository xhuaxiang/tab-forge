import { describe, it, expect } from 'vitest';
import type { Note } from '../../../core/types/index.ts';
import {
    canSourceTechnique,
    isConnectingTarget,
    isConnectingTechnique,
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
