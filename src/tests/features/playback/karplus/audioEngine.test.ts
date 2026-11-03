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
        playNote(
            options: { frequency?: number; duration?: number; palmMute?: boolean; mute?: boolean },
            ...rest: unknown[]
        ) {
            playedNotes(options, ...rest);
            const id = Symbol('note');
            this.activeNotes.set(id, { frequency: options.frequency ?? 0 });
            // 与真实引擎一致：发声时长 + 0.2s 尾音 + 断开余量后不再活跃
            const cleanupMs = ((options.duration ?? 0.8) + 0.2 + 0.05) * 1000;
            setTimeout(() => this.activeNotes.delete(id), cleanupMs);
            return id;
        }
        getNoteFrequency(id: symbol) {
            return this.activeNotes.get(id)?.frequency ?? null;
        }
        isNoteActive(id: symbol) { return this.activeNotes.has(id); }
        stopNote(id: symbol) { this.activeNotes.delete(id); }
        hammerOn(...args: unknown[]) { hammerOns(...args); return args[1] as symbol; }
        pullOff(...args: unknown[]) { return args[1] as symbol; }
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
        const [noteId, depth, rate, startDelay, holdSec] = vibratoNotes.mock.calls[0];
        expect(typeof noteId).toBe('symbol');
        expect(depth).toBeGreaterThan(0);
        expect(rate).toBeGreaterThan(0);
        expect(startDelay).toBeGreaterThan(0);
        // 记谱时值（二分 @120 = 1s）传给合成器，用于短音缩放判定
        expect(holdSec).toBeCloseTo(1, 5);
        expect(bentNotes).not.toHaveBeenCalled();
        engine.dispose();
    });

    it('断音缩短发声时值，但没有技法目标时不影响源音缓冲', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 1, fret: 3, duration: 0.25, staccato: true },
        ]));
        vi.advanceTimersByTime(120);

        expect(playedNotes).toHaveBeenCalledTimes(1);
        const options = playedNotes.mock.calls[0][0] as { duration?: number };
        // 四分 @120 = 0.5s，断音 ×0.5
        expect(options.duration).toBeCloseTo(0.25, 5);
        engine.dispose();
    });

    it('手掌闷音把发声时值压到上限，但没有技法目标时不会被延音找回', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 6, fret: 0, duration: 0.5, palmMute: true },
        ]));
        vi.advanceTimersByTime(120);

        expect(playedNotes).toHaveBeenCalledTimes(1);
        const options = playedNotes.mock.calls[0][0] as { duration?: number };
        expect(options.duration).toBeCloseTo(0.18, 5);
        engine.dispose();
    });

    it('同弦击弦目标音让源音提前生成足够长的尾音', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 1, fret: 5, duration: 0.125 },
            { string: 1, fret: 7, duration: 0.5, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(120); // 只触发第一个音

        expect(playedNotes).toHaveBeenCalledTimes(1);
        // 目标 0.25s 处开始、时值 1s → 源音缓冲区需撑 1.25s
        const options = playedNotes.mock.calls[0][0] as { duration?: number };
        expect(options.duration).toBeCloseTo(1.25, 5);
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
        // 目标是 F3（string 3 第 7 品），且复用起始音的 noteId
        const [toFreq, reusedId] = hammerOns.mock.calls[0];
        expect(toFreq).toBeGreaterThan(0);
        expect(typeof reusedId).toBe('symbol');
        engine.dispose();
    });

    it('短休止后的击弦强制重拨，即使源音缓冲区尚未过期', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 3, fret: 5, duration: 0.125 },
            { string: 3, fret: 0, duration: 0.0625, isRest: true },
            { string: 3, fret: 7, duration: 0.0625, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(600); // 第 1 音 100ms，目标 475ms

        expect(playedNotes).toHaveBeenCalledTimes(2);
        expect(hammerOns).not.toHaveBeenCalled();
        engine.dispose();
    });

    it('休止后的击弦不再延长源音，而是重新拨弦', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 3, fret: 5, duration: 0.125 },
            { string: 3, fret: 0, duration: 0.25, isRest: true },
            { string: 3, fret: 7, duration: 0.125, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(900); // 第 1 音 100ms，休止 500ms，第 3 音 850ms

        // 源音没有被拉过休止
        const source = playedNotes.mock.calls[0][0] as { duration?: number };
        expect(source.duration).toBeCloseTo(0.25, 5);
        // 目标音重新拨弦（源音已过期），技法不连接
        expect(playedNotes).toHaveBeenCalledTimes(2);
        expect(hammerOns).not.toHaveBeenCalled();
        engine.dispose();
    });

    it('被静默强制重拨的目标音，之后仍能作为下一个技法链的源音', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 3, fret: 5, duration: 0.125 },
            { string: 3, fret: 0, duration: 0.0625, isRest: true },
            { string: 3, fret: 7, duration: 0.125, technique: 'hammerOn' },
            { string: 3, fret: 9, duration: 0.125, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(800); // A 100ms，B 475ms，C 725ms

        expect(playedNotes).toHaveBeenCalledTimes(2); // A + 被强制重拨的 B
        expect(hammerOns).toHaveBeenCalledTimes(1); // C 继续复用 B
        engine.dispose();
    });

    it('手掌闷音源音不能作为击弦基础，目标音重新拨弦', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 3, fret: 5, duration: 0.125, palmMute: true },
            { string: 3, fret: 7, duration: 0.125, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(400); // 第 1 音 100ms，第 2 音 350ms

        expect(playedNotes).toHaveBeenCalledTimes(2);
        expect(hammerOns).not.toHaveBeenCalled();
        engine.dispose();
    });
});
