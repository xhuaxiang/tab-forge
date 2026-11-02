/**
 * audioEngine 播放生命周期测试
 *
 * 回归重点：stop/pause 必须清掉已排期的播放事件。
 * 旧实现只检查 state，重播时 state 又变回 'playing'，
 * 上一轮残留的 setTimeout 会与新的一轮重叠（听感：节奏完全错乱）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STANDARD_TUNING, type Note, type TabScore } from '../../../../core/types/index.ts';

const { playedNotes, bentNotes, vibratoNotes, hammerOns } = vi.hoisted(() => ({
    playedNotes: vi.fn(),
    bentNotes: vi.fn(),
    vibratoNotes: vi.fn(),
    hammerOns: vi.fn(),
}));

vi.mock('../../../../features/playback/karplus/guitarEngine.ts', () => ({
    GuitarEngine: class {
        /** 记录正在发声的音符，供击/勾/滑弦的「前一个同弦音」回看 */
        activeNotes = new Map<symbol, { frequency: number }>();
        init() { return {}; }
        playNote(options: { frequency?: number }) {
            playedNotes(options);
            const id = Symbol('note');
            this.activeNotes.set(id, { frequency: options.frequency ?? 0 });
            return id;
        }
        stopNote(id: symbol) { this.activeNotes.delete(id); }
        hammerOn(...args: unknown[]) { hammerOns(...args); return args[2] as symbol; }
        pullOff(...args: unknown[]) { return args[2] as symbol; }
        slideTo(...args: unknown[]) { return args[2] as symbol; }
        bendNote(...args: unknown[]) { bentNotes(...args); }
        vibrato(...args: unknown[]) { vibratoNotes(...args); }
        stopAll() { this.activeNotes.clear(); }
        dispose() {}
    },
}));

// 必须在 vi.mock 之后导入，拿到被替换的 GuitarEngine
import { AudioEngine } from '../../../../features/playback/karplus/audioEngine.ts';

function scoreOf(notes: Note[]): TabScore {
    return {
        title: '',
        artist: '',
        tuning: { ...STANDARD_TUNING },
        bpm: 120, // 四分音符 = 0.5s
        measures: [{
            index: 0,
            notes,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        }],
        timeSignature: '4/4',
    };
}

const THREE_QUARTERS: Note[] = [
    { string: 1, fret: 0, duration: 0.25 },
    { string: 1, fret: 1, duration: 0.25 },
    { string: 1, fret: 2, duration: 0.25 },
];

describe('AudioEngine 播放排期清理', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        playedNotes.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stop 后不再触发已排期的音符', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf(THREE_QUARTERS));
        vi.advanceTimersByTime(200); // 第 1 音在 100ms
        expect(playedNotes).toHaveBeenCalledTimes(1);

        engine.stop();
        vi.advanceTimersByTime(5000);
        expect(playedNotes).toHaveBeenCalledTimes(1);
        engine.dispose();
    });

    it('stop 后重播，上一轮残留事件不会混进新一轮', async () => {
        const engine = new AudioEngine();
        const score = scoreOf(THREE_QUARTERS);

        await engine.play(score);
        vi.advanceTimersByTime(200); // 第一轮：第 1 音（100ms）
        expect(playedNotes).toHaveBeenCalledTimes(1);

        engine.stop();
        await engine.play(score);
        // 新一轮第 1 音在 100ms；旧一轮第 2 音（相对旧起点 600ms）若不清理会在此窗口内冒出
        vi.advanceTimersByTime(500);
        expect(playedNotes).toHaveBeenCalledTimes(2);
        engine.dispose();
    });

    it('连续 stop/play 不会累加播放事件', async () => {
        const engine = new AudioEngine();
        const score = scoreOf(THREE_QUARTERS);
        await engine.play(score);
        engine.stop();
        await engine.play(score);
        engine.stop();
        await engine.play(score);

        vi.advanceTimersByTime(200); // 只有最后一轮的第 1 音
        expect(playedNotes).toHaveBeenCalledTimes(1);
        engine.dispose();
    });
});

describe('推弦 / 揉弦作用于音符自身', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        playedNotes.mockClear();
        bentNotes.mockClear();
        vibratoNotes.mockClear();
        hammerOns.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('推弦音符自己发声并按 bendAmount 上弯（不依赖前一个同弦音）', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            {
                string: 1,
                fret: 5,
                duration: 0.25,
                technique: 'bend',
                bendAmount: 0.5,
                bendRelease: true,
                // 显式力度，避免这条用例依赖 AUTO_METRIC_ACCENT 的派生结果
                dynamics: 'soft',
            },
        ]));
        vi.advanceTimersByTime(120); // 唯一事件在 100ms

        // 旧实现只有在上一音同弦且仍活跃时才推弦，单音直接听不到技法
        expect(playedNotes).toHaveBeenCalledTimes(1);
        // 推弦音符自己拨响时也要带上谱面把位与显式力度
        expect(playedNotes.mock.calls[0][0]).toMatchObject({
            fret: 5,
            dynamics: 'soft',
        });
        expect(bentNotes).toHaveBeenCalledTimes(1);
        const [noteId, semitones, holdSec, release] = bentNotes.mock.calls[0];
        expect(typeof noteId).toBe('symbol');
        expect(semitones).toBeCloseTo(1, 5); // 0.5 全音 = 1 半音
        expect(holdSec).toBeCloseTo(0.5, 5); // 四分音符 @120bpm
        expect(release).toBe(true);
        expect(vibratoNotes).not.toHaveBeenCalled();
        engine.dispose();
    });

    it('揉弦音符自己发声，并在起音后施加 LFO 调制', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 2, fret: 7, duration: 0.5, technique: 'vibrato' },
        ]));
        vi.advanceTimersByTime(120);

        expect(playedNotes).toHaveBeenCalledTimes(1);
        expect(vibratoNotes).toHaveBeenCalledTimes(1);
        const [noteId, depth, rate, startDelay] = vibratoNotes.mock.calls[0];
        expect(typeof noteId).toBe('symbol');
        expect(depth).toBeGreaterThan(0);
        expect(rate).toBeGreaterThan(0);
        expect(startDelay).toBeGreaterThan(0);
        expect(bentNotes).not.toHaveBeenCalled();
        engine.dispose();
    });

    it('普通拨弦把调度力度与谱面把位传到合成器', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 1, fret: 7, duration: 0.25, dynamics: 'soft' },
        ]));
        vi.advanceTimersByTime(120);

        expect(playedNotes).toHaveBeenCalledTimes(1);
        expect(playedNotes.mock.calls[0][0]).toMatchObject({
            fret: 7,
            dynamics: 'soft',
        });
        engine.dispose();
    });

    it('未显式标注力度时，强拍音符按 accent 传入合成器', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 2, fret: 3, duration: 0.25 },
        ]));
        vi.advanceTimersByTime(120);

        expect(playedNotes).toHaveBeenCalledTimes(1);
        expect(playedNotes.mock.calls[0][0]).toMatchObject({
            fret: 3,
            dynamics: 'accent',
        });
        engine.dispose();
    });

    it('击弦仍沿用前一个同弦音（不重新拨弦）', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 3, fret: 5, duration: 0.25 },
            { string: 3, fret: 7, duration: 0.25, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(700); // 第 1 音 100ms，第 2 音 600ms

        expect(playedNotes).toHaveBeenCalledTimes(1); // 只有起始音拨弦
        expect(hammerOns).toHaveBeenCalledTimes(1);
        const [fromFreq, toFreq] = hammerOns.mock.calls[0];
        expect(toFreq).toBeGreaterThan(fromFreq);
        engine.dispose();
    });
});
