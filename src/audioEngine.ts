/**
 * AudioEngine - 音频引擎
 * 负责:
 * 1. 播放六线谱 (Web Audio API 合成)
 * 2. 录音/音频输入 (用于未来扒谱分析)
 */

import type { TabScore, Note, Tuning, Measure } from './types/index.ts';
import { getNoteFromFret, getNoteFrequency } from './types/index.ts';
import { GuitarEngine } from './synthesis/guitarEngine.ts';
import { forEachSlot } from './utils/measureUtils.ts';

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

        // 计算时值
        const beatDuration = 60 / this.bpm;  // 一拍的时间（秒）

        // 各音符时值对应的秒数
        const durationMap: Record<number, number> = {
            1: beatDuration * 4,      // 全音符 = 4拍
            0.5: beatDuration * 2,    // 二分音符 = 2拍
            0.25: beatDuration,       // 四分音符 = 1拍
            0.125: beatDuration / 2,  // 八分音符 = 1/2拍
            0.0625: beatDuration / 4, // 十六分音符 = 1/4拍
            0.03125: beatDuration / 8,// 三十二分音符 = 1/8拍
        };

        // 构建完整播放队列（按时间顺序），使用 setTimeout 调度
        interface ScheduledNote {
            note: Note;
            delayMs: number;
            duration: number;
            volume?: number;
        }

        const schedule: ScheduledNote[] = [];
        let cursorMs = 100; // 延迟100ms开始

        for (let m = 0; m < this.measures.length; m++) {
            const measure = this.measures[m];
            let measureStartMs = cursorMs;

            forEachSlot(measure, (notes) => {
                const durSec = durationMap[notes[0].duration] || beatDuration;
                const durMs = durSec * 1000;

                // 和弦音量补偿：多个音符同时播放时适当降低避免削波
                // 单音=0.5, 双音=0.4, 三音=0.33, 四音=0.29, 五音=0.25, 六音=0.22
                const chordVolume = 0.5 / (1 + (notes.length - 1) * 0.25);

                const arpeggio = notes.length > 1 ? notes[0].arpeggio : undefined;
                const strum = notes.length > 1 ? notes[0].strum : undefined;

                if (strum) {
                    // ---- 扫弦：极短时间内依次拨弦（快速扫过，每弦间隔 10-15ms）----
                    const strumIntervalMs = 12; // 扫弦间隔（毫秒）
                    // down=从6弦到1弦（低→高），up=从1弦到6弦（高→低）
                    const sorted = [...notes].sort((a, b) => {
                        const sa = a.string ?? 6;
                        const sb = b.string ?? 6;
                        return strum === 'down' ? sb - sa : sa - sb;
                    });
                    for (let i = 0; i < sorted.length; i++) {
                        const note = sorted[i];
                        if (note.isRest) continue;
                        schedule.push({
                            note,
                            delayMs: cursorMs + i * strumIntervalMs,
                            duration: durSec,
                            volume: chordVolume,
                        });
                    }
                } else if (arpeggio) {
                    // ---- 琶音：依次拨弦，每根弦间隔 40ms ----
                    const arpIntervalMs = 40;
                    const sorted = [...notes].sort((a, b) => {
                        const sa = a.string ?? 6;
                        const sb = b.string ?? 6;
                        return arpeggio === 'up' ? sb - sa : sa - sb;
                    });
                    for (let i = 0; i < sorted.length; i++) {
                        const note = sorted[i];
                        if (note.isRest) continue;
                        schedule.push({
                            note,
                            delayMs: cursorMs + i * arpIntervalMs,
                            duration: durSec,
                            volume: chordVolume,
                        });
                    }
                } else {
                    // ---- 普通和弦或单音：同时播放 ----
                    for (const note of notes) {
                        if (note.isRest || (note.tieToNext && !note.technique)) continue;
                        schedule.push({ note, delayMs: cursorMs, duration: durSec, volume: chordVolume });
                    }
                }

                cursorMs += durMs;
            });

            // 如果小节空，默认占4拍
            if (cursorMs - measureStartMs < beatDuration * 4 * 1000 - 1) {
                cursorMs = measureStartMs + beatDuration * 4 * 1000;
            }
        }

        const totalDurationMs = cursorMs;

        // 调度播放所有音符
        for (const item of schedule) {
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

/**
 * 录音管理器 (用于未来扒谱功能)
 */
export class AudioRecorder {
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private stream: MediaStream | null = null;
    private isRecording: boolean = false;

    /** 开始录音 */
    async startRecording(): Promise<boolean> {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : 'audio/mp4',
            });

            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            return true;
        } catch (error) {
            console.error('录音启动失败:', error);
            return false;
        }
    }

    /** 停止录音 */
    stopRecording(): Blob | null {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;

            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }

            if (this.audioChunks.length > 0) {
                return new Blob(this.audioChunks, { type: 'audio/webm' });
            }
        }
        return null;
    }

    /** 获取录音状态 */
    getIsRecording(): boolean {
        return this.isRecording;
    }
}

/** 全局单例 */
export const currentAudioEngine = new AudioEngine();
export const currentAudioRecorder = new AudioRecorder();
