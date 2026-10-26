/**
 * AudioEngine - 音频引擎
 * 负责:
 * 1. 播放六线谱 (Web Audio API 合成)
 * 2. 录音已拆到 recorder.ts
 */

import type { TabScore, Note, Tuning, Measure, PlaybackState } from '../../../core/types/index.ts';
import { getNoteFromFret, getNoteFrequency, STANDARD_TUNING } from '../../../core/types/index.ts';
import { DEFAULT_HARMONIC_FRET, KARPLUS_ARTICULATION } from '../../../core/config.ts';
import { deltaFretToHarmonicValue, harmonicValueToSemitones } from '../../../core/utils/scoreMapping.ts';
import { GuitarEngine } from './guitarEngine.ts';
import { buildSchedule } from './scheduling.ts';

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
    private tuning: Tuning = { ...STANDARD_TUNING };
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
        let frequency = getNoteFrequency(noteName);

        if (!frequency || !note.string) return null;

        // 泛音：自然泛音从空弦叠加，人工/捏弦从按弦音叠加（半音数由节点品位查表）
        if (note.harmonic) {
            const baseName = note.harmonic === 'natural'
                ? getNoteFromFret(this.tuning, str, 0)
                : noteName;
            const baseFrequency = getNoteFrequency(baseName);
            if (baseFrequency > 0) {
                const deltaFret = note.harmonic === 'natural'
                    ? (note.fret ?? 0)
                    : (note.harmonicFret ?? DEFAULT_HARMONIC_FRET);
                const semitones = harmonicValueToSemitones(deltaFretToHarmonicValue(deltaFret));
                frequency = baseFrequency * Math.pow(2, semitones / 12);
            }
        }

        // 奏法对发声时值/音量的修正（记谱时值仍用于技法释放的时机）
        let effectiveDuration = duration;
        let effectiveVolume = volume ?? 0.5;
        // 断音优先于自由延音：两者同时开时，断音不应被 +0.8s 抵消
        if (note.staccato) {
            effectiveDuration *= KARPLUS_ARTICULATION.staccatoDurationFactor;
        } else if (note.letRing) {
            effectiveDuration += KARPLUS_ARTICULATION.letRingExtraSec;
        }
        if (note.palmMute) {
            effectiveDuration = Math.min(effectiveDuration, KARPLUS_ARTICULATION.palmMuteMaxSec);
            effectiveVolume *= KARPLUS_ARTICULATION.palmMuteVolumeFactor;
        }
        if (note.deadNote) {
            effectiveDuration = Math.min(effectiveDuration, KARPLUS_ARTICULATION.deadNoteMaxSec);
            effectiveVolume *= KARPLUS_ARTICULATION.deadNoteVolumeFactor;
        }
        if (note.harmonic) effectiveVolume *= KARPLUS_ARTICULATION.harmonicVolumeFactor;

        // 获取该弦上当前的活跃音符
        const lastNoteId = this.stringNoteMap.get(str) ?? null;

        // 如果有前一音符且当前是技法，用技巧连接。
        // 制音/泛音必须重新发声，不能借用前一个音的调制。
        if (lastNoteId && note.technique && !note.deadNote && !note.harmonic) {
            const ge = this.guitar as any;
            const activeNote = ge.activeNotes?.get(lastNoteId);
            if (activeNote) {
                const lastFreq = activeNote.frequency || frequency;
                switch (note.technique) {
                    case 'hammerOn':
                        this.guitar.hammerOn(lastFreq, frequency, lastNoteId);
                        return this.finishTechniqueNote(lastNoteId, note, effectiveDuration, str);
                    case 'pullOff':
                        this.guitar.pullOff(lastFreq, frequency, lastNoteId);
                        return this.finishTechniqueNote(lastNoteId, note, effectiveDuration, str);
                    case 'slide':
                        this.guitar.slideTo(frequency, 0.15, lastNoteId);
                        return this.finishTechniqueNote(lastNoteId, note, effectiveDuration, str);
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
                        return this.finishTechniqueNote(lastNoteId, note, effectiveDuration, str);
                    }
                    case 'vibrato':
                        // 揉弦：对当前活跃音符施加 LFO 音高调制
                        this.guitar.vibrato(lastNoteId, 0.015, 5.5);
                        return this.finishTechniqueNote(lastNoteId, note, effectiveDuration, str);
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
            duration: effectiveDuration,
            volume: effectiveVolume,
            string: str,
            mute: !!note.deadNote,
            palmMute: !!note.palmMute,
        });
        this.stringNoteMap.set(str, noteId);
        return noteId;
    }

    /**
     * 技法连接（不重新拨弦）后的奏法收尾。
     * 闷音/断音的时值与音色修正落到当前正在发声的音符上，避免被技法分支静默吞掉。
     */
    private finishTechniqueNote(noteId: symbol, note: Note, durationSec: number, str: number): symbol {
        this.stringNoteMap.set(str, noteId);
        if (note.palmMute || note.staccato) {
            this.guitar.dampNote(
                noteId,
                durationSec,
                note.palmMute ? KARPLUS_ARTICULATION.palmMuteVolumeFactor : 1,
                !!note.palmMute,
            );
        }
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
