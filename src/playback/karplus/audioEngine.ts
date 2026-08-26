/**
 * AudioEngine - 音频引擎
 * 负责:
 * 1. 播放六线谱 (Web Audio API 合成)
 * 2. 录音已拆到 recorder.ts
 */

import type { TabScore, Note, Tuning, Measure } from '../../types/index.ts';
import { getNoteFromFret, getNoteFrequency } from '../../types/index.ts';
import { GuitarEngine } from './guitarEngine.ts';
import { buildSchedule } from './scheduling.ts';

/** 播放状态 */
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';

/** 播放回调 */
export interface PlaybackCallbacks {
    onPositionChange?: (measureIndex: number, positionInMeasure: number) => void;
    onStateChange?: (state: PlaybackState) => void;
    onComplete?: () => void;
}

export class AudioEngine {
    private guitar: GuitarEngine = new GuitarEngine();
    private state: PlaybackState = 'idle';
    private startTime: number = 0;
    private bpm: number = 120;
    private tuning: Tuning = { string1: 'E4', string2: 'B3', string3: 'G3', string4: 'D3', string5: 'A2', string6: 'E2' };
    private callbacks: PlaybackCallbacks = {};
    private timerId: ReturnType<typeof setTimeout> | null = null;
    private measures: Measure[] = [];
    /** 记录每个弦上最后一个活跃的 noteId，用于击弦/勾弦/滑弦 */
    private stringNoteMap: Map<number, symbol | null> = new Map();

    /** 获取当前状态 */
    getState(): PlaybackState {
        return this.state;
    }

    /** 设置播放参数 */
    setScore(score: TabScore): void {
        this.bpm = score.bpm || 120;
        this.tuning = score.tuning;
        this.measures = score.measures;
    }

    /** 注册回调 */
    setCallbacks(callbacks: PlaybackCallbacks): void {
        this.callbacks = callbacks;
    }

    /** 播放音符 (使用 GuitarEngine，支持技法连接) */
    private playNote(
        note: Note,
        duration: number,
        volume?: number,
    ): symbol | null {
        const str = note.string ?? 1;
        const noteName = getNoteFromFret(this.tuning, str, note.fret ?? 0);
        const frequency = getNoteFrequency(noteName);

        if (!frequency || !note.string) return null;

        // 获取该弦上当前的活跃音符
        const lastNoteId = this.stringNoteMap.get(str) ?? null;

        // 如果有前一音符且当前是技法，用技巧连接
        if (lastNoteId && note.technique) {
            const ge = this.guitar as any;
            const activeNote = ge.activeNotes?.get(lastNoteId);
            if (activeNote) {
                const lastFreq = activeNote.frequency || frequency;
                switch (note.technique) {
                    case 'hammerOn':
                        this.guitar.hammerOn(lastFreq, frequency, lastNoteId);
                        this.stringNoteMap.set(str, lastNoteId);
                        return lastNoteId;
                    case 'pullOff':
                        this.guitar.pullOff(lastFreq, frequency, lastNoteId);
                        this.stringNoteMap.set(str, lastNoteId);
                        return lastNoteId;
                    case 'slide':
                        this.guitar.slideTo(frequency, 0.15, lastNoteId);
                        this.stringNoteMap.set(str, lastNoteId);
                        return lastNoteId;
                    case 'bend': {
                        // 推弦幅度（bendAmount 以全音为单位，转为半音数）
                        const bendSemitones = (note.bendAmount || 1) * 2;
                        const targetFreq = lastFreq * Math.pow(2, bendSemitones / 12);
                        this.guitar.bendTo(targetFreq, 0.12, lastNoteId);
                        if (note.bendRelease) {
                            // 推弦后释放：在该音符时值末尾前 100ms 弯回原音高
                            // duration 单位为秒，需 ×1000 转毫秒（旧代码 ×500 导致提前回弹）
                            const releaseDelayMs = Math.max(0, duration * 1000 - 100);
                            setTimeout(() => {
                                if (this.state !== 'playing') return;
                                // 若该弦已被新音符取代（停止/换新），则不再对旧音符回弹
                                if (this.stringNoteMap.get(str) !== lastNoteId) return;
                                this.guitar.bendTo(lastFreq, 0.1, lastNoteId);
                            }, releaseDelayMs);
                        }
                        this.stringNoteMap.set(str, lastNoteId);
                        return lastNoteId;
                    }
                    case 'vibrato':
                        // 揉弦：对当前活跃音符施加 LFO 音高调制
                        this.guitar.vibrato(lastNoteId, 0.015, 5.5);
                        this.stringNoteMap.set(str, lastNoteId);
                        return lastNoteId;
                }
            }
        }

        // 普通拨弦（或技法但无前一个活跃音符）
        // 先停止同弦上一个活跃音符，避免与旧音叠加
        if (lastNoteId) {
            this.guitar.stopNote(lastNoteId);
        }
        const noteId = this.guitar.playNote({
            frequency,
            duration,
            volume: volume ?? 0.5,
            string: str,
        });
        this.stringNoteMap.set(str, noteId);
        return noteId;
    }

    /** 开始播放 */
    async play(score?: TabScore): Promise<void> {
        if (score) {
            this.setScore(score);
        }

        if (this.state === 'playing') return;

        this.guitar.init();
        this.state = 'playing';
        this.callbacks.onStateChange?.('playing');

        // 清空弦记录
        this.stringNoteMap.clear();

        // 构建播放调度（纯函数层：时值→秒、扫弦/琶音、音量补偿、空小节兜底）
        const { events, totalDurationMs } = buildSchedule(this.measures, this.bpm);

        // 调度播放所有音符
        for (const item of events) {
            setTimeout(() => {
                if (this.state !== 'playing') return;
                this.playNote(item.note, item.duration, item.volume);
            }, item.delayMs);
        }

        // 计算总时长后停止
        this.startTime = performance.now();

        // 轮询位置回调
        const updatePosition = () => {
            if (this.state !== 'playing') return;
            const elapsed = performance.now() - this.startTime;
            const currentMeasure = Math.min(
                Math.floor((elapsed / totalDurationMs) * this.measures.length),
                this.measures.length - 1,
            );
            this.callbacks.onPositionChange?.(currentMeasure, 0);

            if (elapsed >= totalDurationMs) {
                this.stop();
                this.callbacks.onComplete?.();
                return;
            }
            this.timerId = setTimeout(updatePosition, 50);
        };
        this.timerId = setTimeout(updatePosition, 100);

        // 定时自动停止
        setTimeout(() => {
            if (this.state === 'playing') {
                this.stop();
                this.callbacks.onComplete?.();
            }
        }, totalDurationMs + 200);
    }

    /** 停止播放 */
    stop(): void {
        this.state = 'stopped';
        this.guitar.stopAll();
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.callbacks.onStateChange?.('stopped');
        this.callbacks.onPositionChange?.(0, 0);
    }

    /** 暂停 */
    pause(): void {
        if (this.state !== 'playing') return;
        this.state = 'paused';
        this.guitar.stopAll();
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.callbacks.onStateChange?.('paused');
    }

    /** 释放资源 */
    dispose(): void {
        this.stop();
        this.guitar.dispose();
    }
}

/** 全局单例 */
export const currentAudioEngine = new AudioEngine();
