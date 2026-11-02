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
    /**
     * 已排期的播放事件与自动停止计时器。
     *
     * stop/pause 必须清掉：旧一轮的 setTimeout 只检查 state，重播时 state 又变回
     * 'playing'，上一轮的幽灵音符会与新的一轮重叠，听感就是节奏完全错乱。
     */
    private eventTimers: Array<ReturnType<typeof setTimeout>> = [];
    /** 播放代次：每次 play/stop/pause 递增，让上一代已排期的回调失效 */
    private runId = 0;
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

        // 推弦/揉弦作用于技法音符**自己**：先拨响它，再在它的声音上加调制。
        // 旧实现借用上一个同弦音，前一个音不在同弦或已停止时技法就完全消失；
        // 即便借用成功，响的也是上一个音，与谱面写的音符对不上。
        if ((note.technique === 'bend' || note.technique === 'vibrato')
            && !note.deadNote && !note.harmonic) {
            if (lastNoteId) this.guitar.stopNote(lastNoteId);
            const noteId = this.guitar.playNote({
                frequency,
                duration: effectiveDuration,
                volume: effectiveVolume,
                string: str,
                mute: false,
                palmMute: !!note.palmMute,
            });
            if (note.technique === 'bend') {
                // bendAmount 以全音为单位（1 全音 = 2 个半音）
                this.guitar.bendNote(
                    noteId,
                    (note.bendAmount ?? 1) * 2,
                    effectiveDuration,
                    !!note.bendRelease,
                );
            } else {
                this.guitar.vibrato(
                    noteId,
                    KARPLUS_ARTICULATION.vibratoDepth,
                    KARPLUS_ARTICULATION.vibratoRate,
                    KARPLUS_ARTICULATION.vibratoStartSec,
                );
            }
            this.stringNoteMap.set(str, noteId);
            return this.finishTechniqueNote(noteId, note, effectiveDuration, str);
        }

        // 击弦/勾弦/滑弦：目标音不重新拨弦，靠前一个同弦音的技法连接发声。
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
     * 技法音符的奏法收尾。
     * 击/勾/滑复用前一个同弦音；推/揉弦作用于自身新拨响的音。
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

        // 停掉上一代残留的排期：stop 后立刻重播时，旧 setTimeout 不能再发声
        this.clearEventTimers();
        const runId = ++this.runId;

        this.guitar.init();
        this.state = 'playing';
        this.callbacks.onStateChange?.('playing');

        // 清空弦记录
        this.stringNoteMap.clear();

        // 构建播放调度（纯函数层：时值→秒、扫弦/琶音、音量补偿、空小节兜底）
        const { events, totalDurationMs } = buildSchedule(this.measures, this.bpm);

        // 调度播放所有音符；代次校验同时挡住 stop/pause 后残留的旧回调
        for (const item of events) {
            this.eventTimers.push(setTimeout(() => {
                if (this.runId !== runId || this.state !== 'playing') return;
                this.playNote(item.note, item.duration, item.volume);
            }, item.delayMs));
        }

        // 计算总时长后停止
        this.startTime = performance.now();

        // 轮询位置回调
        const updatePosition = () => {
            if (this.runId !== runId || this.state !== 'playing') return;
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

        // 定时自动停止（旧一轮的计时器不能掐断新一轮，代次校验 + stop 清空）
        this.eventTimers.push(setTimeout(() => {
            if (this.runId !== runId || this.state !== 'playing') return;
            this.stop();
            this.callbacks.onComplete?.();
        }, totalDurationMs + 200));
    }

    /** 清掉所有已排期的播放事件/自动停止计时器 */
    private clearEventTimers(): void {
        for (const id of this.eventTimers) clearTimeout(id);
        this.eventTimers = [];
    }

    /** 停止播放 */
    stop(): void {
        this.runId++;
        this.clearEventTimers();
        this.state = 'stopped';
        this.guitar.stopAll();
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.callbacks.onStateChange?.('stopped');
        this.callbacks.onPositionChange?.(0, 0);
    }

    /** 暂停（当前实现暂停后再次 play 会从头开始，先清干净旧排期） */
    pause(): void {
        if (this.state !== 'playing') return;
        this.runId++;
        this.clearEventTimers();
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
