/**
 * alphaTabPlayer — SoundFont 播放封装（懒加载单例）
 *
 * 实现与 AudioEngine 相同的 PlaybackCallbacks 契约，
 * 供 eventHandlers 在「SoundFont」引擎下直接替换使用。
 *
 * 设计要点：
 * - 顶层不 import '@coderline/alphatab'（只在首次 play 时动态加载），
 *   避免弹窗无谓加载渲染/合成大包。
 * - 直接走 alphaTab 主线程合成器（AlphaSynth + MidiFileGenerator），
 *   不创建渲染 worker / audio worklet / DOM 容器。
 * - 适配层独立在 scoreAdapter.ts，本文件只做播放生命周期。
 */

import type { PlaybackCallbacks, PlaybackState } from '../karplus/index.ts';
import type { TabScore } from '../../types/index.ts';
import { tabScoreToAlphaTabScore } from '../../alphaTab/scoreAdapter.ts';
import { createAlphaTabWorkletOutput } from './alphaTabOutput.ts';
import soundfontUrl from '@coderline/alphatab/soundfont/sonivox.sf3?url';

/** 我们用到的 AlphaSynth 子集 */
interface AlphaSynthHandle {
    play(): void;
    pause(): void;
    stop(): void;
    destroy(): void;
    loadSoundFont(data: Uint8Array, append: boolean): void;
    loadMidiFile(midi: unknown): void;
    isReadyForPlayback: boolean;
    stateChanged: { on(handler: (e: { state: number; stopped: boolean }) => void): void };
    positionChanged: { on(handler: (e: { currentTick: number }) => void): void };
    finished: { on(handler: () => void): void };
}

type AlphaTabModule = typeof import('@coderline/alphatab');

class AlphaTabPlayer {
    private mod: AlphaTabModule | null = null;
    private synth: AlphaSynthHandle | null = null;
    private callbacks: PlaybackCallbacks = {};
    private measureStarts: number[] = [];
    private lastMeasure = -1;
    private initializing: Promise<void> | null = null;
    private broken = false;

    setCallbacks(callbacks: PlaybackCallbacks): void {
        this.callbacks = callbacks;
    }

    async play(score: TabScore): Promise<void> {
        if (this.broken) throw new Error('alphaTab player 不可用（上次初始化失败）');
        await this.ensureInitialized();
        if (!this.synth || !this.mod) throw new Error('alphaTab player 未初始化');

        const mod = this.mod;
        const atScore = tabScoreToAlphaTabScore(score);
        const midi = new mod.midi.MidiFile();
        const generator = new mod.midi.MidiFileGenerator(
            atScore,
            null,
            new mod.midi.AlphaSynthMidiFileHandler(midi),
        );
        generator.generate();

        // 每小节起始 tick，用于 currentTick → 小节号
        this.measureStarts = generator.tickLookup.masterBars.map((mb) => mb.start);
        this.lastMeasure = -1;

        this.synth.loadMidiFile(midi);
        await this.waitReady();
        this.synth.play();
    }

    stop(): void {
        if (this.synth) this.synth.stop();
        this.lastMeasure = -1;
        this.callbacks.onPositionChange?.(0, 0);
    }

    pause(): void {
        this.synth?.pause();
    }

    dispose(): void {
        this.synth?.destroy();
        this.synth = null;
        this.mod = null;
        this.measureStarts = [];
    }

    private async ensureInitialized(): Promise<void> {
        if (this.synth) return;
        if (this.initializing) {
            await this.initializing;
            return;
        }
        this.initializing = this.init();
        try {
            await this.initializing;
        } catch (e) {
            this.broken = true;
            this.synth = null;
            this.mod = null;
            throw e;
        } finally {
            this.initializing = null;
        }
    }

    private async init(): Promise<void> {
        const mod = await import('@coderline/alphatab');
        this.mod = mod;

        const output = createAlphaTabWorkletOutput(mod);
        const synth = new mod.synth.AlphaSynth(output, 100) as unknown as AlphaSynthHandle;

        synth.stateChanged.on((e) => {
            const playing = mod.synth.PlayerState.Playing;
            const paused = mod.synth.PlayerState.Paused;
            if (e.state === playing) {
                this.emitState('playing');
            } else if (e.state === paused) {
                this.emitState(e.stopped ? 'stopped' : 'paused');
            }
        });
        synth.positionChanged.on((e) => {
            const index = this.measureIndexAt(e.currentTick);
            if (index !== this.lastMeasure) {
                this.lastMeasure = index;
                this.callbacks.onPositionChange?.(index, 0);
            }
        });
        synth.finished.on(() => {
            this.emitState('stopped');
            this.callbacks.onComplete?.();
        });

        const res = await fetch(soundfontUrl);
        if (!res.ok) throw new Error(`加载 SoundFont 失败: HTTP ${res.status}`);
        const data = new Uint8Array(await res.arrayBuffer());
        synth.loadSoundFont(data, false);

        this.synth = synth;
    }

    private emitState(state: PlaybackState): void {
        this.callbacks.onStateChange?.(state);
    }

    /** currentTick → 小节序号（按 measureStarts 二分） */
    private measureIndexAt(tick: number): number {
        const starts = this.measureStarts;
        let lo = 0;
        let hi = starts.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (starts[mid] <= tick) lo = mid + 1;
            else hi = mid;
        }
        return Math.max(0, lo - 1);
    }

    /** 等待合成器就绪（SoundFont + Midi 加载 + 缓冲建立），避免 play() 空转 */
    private waitReady(): Promise<void> {
        const synth = this.synth;
        if (!synth || synth.isReadyForPlayback) return Promise.resolve();
        return new Promise((resolve) => {
            const started = performance.now();
            const timer = setInterval(() => {
                if (synth.isReadyForPlayback || performance.now() - started > 3000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 25);
        });
    }
}

export const alphaTabPlayer = new AlphaTabPlayer();
