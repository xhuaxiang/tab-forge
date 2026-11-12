/**
 * audioEngine 播放生命周期测试
 *
 * 回归重点：stop/pause 必须清掉已排期的播放事件。
 * 旧实现只检查 state，重播时 state 又变回 'playing'，
 * 上一轮残留的 setTimeout 会与新的一轮重叠（听感：节奏完全错乱）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STANDARD_TUNING, type Note, type TabScore } from '../../../../core/types/index.ts';
import { KARPLUS_ARTICULATION } from '../../../../core/config.ts';

const { playedNotes, bentNotes, vibratoNotes, hammerOns, stopAlls } = vi.hoisted(() => ({
    playedNotes: vi.fn(),
    bentNotes: vi.fn(),
    vibratoNotes: vi.fn(),
    hammerOns: vi.fn(),
    stopAlls: vi.fn(),
}));

vi.mock('../../../../features/playback/karplus/guitarEngine.ts', () => ({
    GuitarEngine: class {
        /** 记录正在发声的音符，供击/勾/滑弦的「前一个同弦音」回看 */
        activeNotes = new Map<symbol, { frequency: number }>();
        init() { return {}; }
        playNote(
            options: {
                frequency?: number;
                duration?: number;
                palmMute?: boolean;
                mute?: boolean;
                playbackRateScale?: number;
            },
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
        stopAll(...args: unknown[]) { stopAlls(...args); this.activeNotes.clear(); }
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
        // 播放位置/暂停点用 performance.now()，必须一起 fake 才能推进时间
        vi.useFakeTimers({
            toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
        });
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

    it('暂停后继续从暂停位置续播，不从头重播', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf(THREE_QUARTERS));
        vi.advanceTimersByTime(200); // 第 1 音在 100ms
        expect(playedNotes).toHaveBeenCalledTimes(1);

        engine.pause();
        vi.advanceTimersByTime(1000); // 暂停期间不发声
        expect(playedNotes).toHaveBeenCalledTimes(1);

        await engine.play(); // 继续
        // 第 2 音原定 600ms，暂停点在 200ms → 继续后还需约 400ms
        vi.advanceTimersByTime(350);
        expect(playedNotes).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(100);
        expect(playedNotes).toHaveBeenCalledTimes(2);
        // 续播的必须是第 2 个音（fret 1），不是把第 1 音再播一遍
        expect(playedNotes.mock.calls[1][0]).toMatchObject({ fret: 1 });
        engine.dispose();
    });

    it('暂停后 stop 再播放从头开始', async () => {
        const engine = new AudioEngine();
        const score = scoreOf(THREE_QUARTERS);
        await engine.play(score);
        vi.advanceTimersByTime(200); // 第 1 音（fret 0）
        engine.pause();
        engine.stop();
        playedNotes.mockClear();

        await engine.play(score);
        vi.advanceTimersByTime(150);
        expect(playedNotes).toHaveBeenCalledTimes(1);
        expect(playedNotes.mock.calls[0][0]).toMatchObject({ fret: 0 });
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
        // 播放位置/暂停点用 performance.now()，必须一起 fake 才能推进时间
        vi.useFakeTimers({
            toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
        });
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
                // 显式力度，钉住谱面标识会传到合成器
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
        // 缓冲区按推弦目标倍率预拉长，音高上弯不再提前放完缓冲
        expect(playedNotes.mock.calls[0][0].playbackRateScale)
            .toBeCloseTo(Math.pow(2, 1 / 12), 5);
        expect(bentNotes).toHaveBeenCalledTimes(1);
        const [noteId, semitones, holdSec, release] = bentNotes.mock.calls[0];
        expect(typeof noteId).toBe('symbol');
        expect(semitones).toBeCloseTo(1, 5); // 0.5 全音 = 1 半音
        // 缓冲预拉长倍率必须与推弦目标速率同源，否则缓冲按 A 拉长、音高按 B 弯
        expect(playedNotes.mock.calls[0][0].playbackRateScale)
            .toBeCloseTo(Math.pow(2, semitones / 12), 5);
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
        // 揉弦是围绕原速的对称调制，平均速率不变，不需要拉长缓冲
        expect(playedNotes.mock.calls[0][0].playbackRateScale).toBe(1);
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

    it('同弦升品击弦按链上倍率预拉长源音缓冲', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 1, fret: 5, duration: 0.125 },
            { string: 1, fret: 7, duration: 0.25, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(120); // 只触发源音

        expect(playedNotes).toHaveBeenCalledTimes(1);
        // 目标高 2 个半音：缓冲要按同一倍率拉长，否则滑到目标后提前放完
        // （频率表是等律近似值，尾数有几位误差）
        expect(playedNotes.mock.calls[0][0].playbackRateScale)
            .toBeCloseTo(Math.pow(2, 2 / 12), 4);
        engine.dispose();
    });

    it('推弦源音与链上更高目标取较大倍率', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 1, fret: 5, duration: 0.125, technique: 'bend', bendAmount: 1 },
            { string: 1, fret: 12, duration: 0.25, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(120);

        // 推弦自身 2 个半音；链上目标 7 个半音 → 取 7
        expect(playedNotes.mock.calls[0][0].playbackRateScale)
            .toBeCloseTo(Math.pow(2, 7 / 12), 4);
        engine.dispose();
    });

    it('推弦峰值高于链上目标时取推弦倍率', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            // 推 2 个全音 = 4 个半音；目标只高 1 个半音
            { string: 1, fret: 5, duration: 0.125, technique: 'bend', bendAmount: 2 },
            { string: 1, fret: 6, duration: 0.25, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(120);

        expect(playedNotes.mock.calls[0][0].playbackRateScale)
            .toBeCloseTo(Math.pow(2, 4 / 12), 5);
        engine.dispose();
    });

    it('勾弦下滑的链倍率保持 1（缓冲只拉长不缩短）', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 1, fret: 12, duration: 0.125 },
            { string: 1, fret: 5, duration: 0.25, technique: 'pullOff' },
        ]));
        vi.advanceTimersByTime(120);

        expect(playedNotes.mock.calls[0][0].playbackRateScale).toBe(1);
        engine.dispose();
    });

    it('超出上限的链倍率夹到 maxPlaybackRateScale', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            // 30 品超出 UI 合法范围，仅用于验证异常输入不会把缓冲拉到不可控大小
            { string: 1, fret: 0, duration: 0.125 },
            { string: 1, fret: 30, duration: 0.25, technique: 'hammerOn' },
        ]));
        vi.advanceTimersByTime(120);

        expect(playedNotes.mock.calls[0][0].playbackRateScale)
            .toBe(KARPLUS_ARTICULATION.maxPlaybackRateScale);
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

    it('未显式标注力度时不派生 accent，合成器收到 undefined', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf([
            { string: 2, fret: 3, duration: 0.25 },
        ]));
        vi.advanceTimersByTime(120);

        expect(playedNotes).toHaveBeenCalledTimes(1);
        expect(playedNotes.mock.calls[0][0].fret).toBe(3);
        expect(playedNotes.mock.calls[0][0].dynamics).toBeUndefined();
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

describe('自然收尾', () => {
    beforeEach(() => {
        vi.useFakeTimers({
            toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
        });
        playedNotes.mockClear();
        stopAlls.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('末音尾音走完后用长淡出收尾，完成回调等淡出结束', async () => {
        const engine = new AudioEngine();
        const onComplete = vi.fn();
        engine.setCallbacks({ onComplete });

        // 4 个四分音符填满 4/4：谱面 2100ms 结束，末音 1600ms 起、发声到 2300ms
        await engine.play(scoreOf([
            { string: 1, fret: 0, duration: 0.25 },
            { string: 1, fret: 1, duration: 0.25 },
            { string: 1, fret: 2, duration: 0.25 },
            { string: 1, fret: 3, duration: 0.25 },
        ]));

        vi.advanceTimersByTime(2299);
        expect(stopAlls).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        // 自然收尾起点：长淡出，而不是 stop() 的 0.03s 快淡出
        expect(stopAlls).toHaveBeenCalledWith(KARPLUS_ARTICULATION.naturalEndFadeSec);
        expect(onComplete).not.toHaveBeenCalled();

        vi.advanceTimersByTime(KARPLUS_ARTICULATION.naturalEndFadeSec * 1000);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(engine.getState()).toBe('stopped');
        engine.dispose();
    });

    it('末音在谱面结束前就衰减完时，仍等谱面结束再收尾', async () => {
        const engine = new AudioEngine();
        const onComplete = vi.fn();
        engine.setCallbacks({ onComplete });

        // 单个四分音符在 100ms 发声，但 4/4 小节补齐到 2100ms
        await engine.play(scoreOf([{ string: 1, fret: 0, duration: 0.25 }]));

        vi.advanceTimersByTime(2099);
        expect(stopAlls).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(stopAlls).toHaveBeenCalledWith(KARPLUS_ARTICULATION.naturalEndFadeSec);
        expect(onComplete).not.toHaveBeenCalled();

        vi.advanceTimersByTime(KARPLUS_ARTICULATION.naturalEndFadeSec * 1000);
        expect(onComplete).toHaveBeenCalledTimes(1);
        engine.dispose();
    });

    it('手动 pause/stop 仍用默认短淡出', async () => {
        const engine = new AudioEngine();
        await engine.play(scoreOf(THREE_QUARTERS));
        vi.advanceTimersByTime(120);

        engine.pause();
        expect(stopAlls.mock.calls.at(-1)).toEqual([]);
        engine.stop();
        expect(stopAlls.mock.calls.at(-1)).toEqual([]);
        // 不能把自然收尾时长误用到用户主动停止上
        expect(stopAlls).not.toHaveBeenCalledWith(KARPLUS_ARTICULATION.naturalEndFadeSec);
        engine.dispose();
    });

    it('暂停点落在自然淡出区间内，续播重新起一段完整淡出', async () => {
        const engine = new AudioEngine();
        const onComplete = vi.fn();
        engine.setCallbacks({ onComplete });
        // 4 个四分音符：自然尾音 2300ms 结束、原完成点 2800ms
        await engine.play(scoreOf([
            { string: 1, fret: 0, duration: 0.25 },
            { string: 1, fret: 1, duration: 0.25 },
            { string: 1, fret: 2, duration: 0.25 },
            { string: 1, fret: 3, duration: 0.25 },
        ]));

        // 在淡出中间暂停（2400ms）：pause 仍走默认短淡出
        vi.advanceTimersByTime(2400);
        engine.pause();
        expect(stopAlls.mock.calls.at(-1)).toEqual([]);
        stopAlls.mockClear();

        await engine.play(); // 续播：淡出从 2400ms 重新起 0.5s
        vi.advanceTimersByTime(1);
        expect(stopAlls.mock.calls.at(-1))
            .toEqual([KARPLUS_ARTICULATION.naturalEndFadeSec]);
        expect(onComplete).not.toHaveBeenCalled();

        // 原 finish 只剩 0.4s；必须从续播点重新等满 0.5s
        vi.advanceTimersByTime(498);
        expect(onComplete).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
        engine.dispose();
    });
});
