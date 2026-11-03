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
import { resolvePlayDuration } from '../../../core/utils/playbackDuration.ts';
import { canSourceTechnique, isConnectingTarget } from '../../../core/utils/technique.ts';
import { GuitarEngine } from './guitarEngine.ts';
import { buildSchedule, computeForceRepluck, computeTechniqueRing } from './scheduling.ts';

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
    /** 该弦上最后一个音能否作为连接基础（palmMute/断音/制音为 false） */
    private stringConnectable: Map<number, boolean> = new Map();

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

    /**
     * 播放音符 (使用 GuitarEngine，支持技法连接)
     *
     * @param ringSec 该音作为源音需要保持发声的最短时长（秒），
     *                供后续同弦击/勾/滑目标音延续
     * @param forceRepluck 调度层判定该技法目标被静默隔开，必须重新拨弦
     */
    private playNote(
        note: Note,
        duration: number,
        volume?: number,
        dynamics?: Note['dynamics'],
        ringSec?: number,
        forceRepluck = false,
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
        const effectiveDuration = resolvePlayDuration(note, duration);
        // 后续同弦技法目标音复用这段缓冲，源音至少要撑到最后一个目标结束
        const ringDuration = Math.max(effectiveDuration, ringSec ?? 0);
        let effectiveVolume = volume ?? 0.5;
        if (note.palmMute) {
            effectiveVolume *= KARPLUS_ARTICULATION.palmMuteVolumeFactor;
        }
        if (note.deadNote) {
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
                duration: ringDuration,
                volume: effectiveVolume,
                string: str,
                mute: false,
                palmMute: !!note.palmMute,
                dynamics,
                fret: note.fret ?? 0,
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
                    effectiveDuration,
                );
            }
            return this.finishTechniqueNote(
                noteId,
                note,
                effectiveDuration,
                str,
                canSourceTechnique(note),
            );
        }

        // 击弦/勾弦/滑弦：目标音不重新拨弦，靠前一个同弦音的技法连接发声。
        // 制音/泛音必须重新发声；palmMute/断音/制音的源音衰减包络不适合复用。
        // 调度层判定被静默隔开（forceRepluck）时同样回落到重新拨弦。
        // 注意：复用模型下目标音的调度音量/力度不生效，增益只来自源音的 baseVolume × 技法系数。
        if (lastNoteId && isConnectingTarget(note) && !forceRepluck
            && this.stringConnectable.get(str) === true
            && this.guitar.isNoteActive(lastNoteId)) {
            // 目标音自己带 palmMute/断音时会把复用中的缓冲压短，之后不能再连接
            const connectableAfter = canSourceTechnique(note);
            switch (note.technique) {
                case 'hammerOn':
                    this.guitar.hammerOn(frequency, lastNoteId);
                    return this.finishTechniqueNote(
                        lastNoteId, note, effectiveDuration, str, connectableAfter,
                    );
                case 'pullOff':
                    this.guitar.pullOff(frequency, lastNoteId);
                    return this.finishTechniqueNote(
                        lastNoteId, note, effectiveDuration, str, connectableAfter,
                    );
                case 'slide':
                    this.guitar.slideTo(
                        frequency,
                        Math.min(
                            KARPLUS_ARTICULATION.slideSec,
                            Math.max(KARPLUS_ARTICULATION.slideMinSec, effectiveDuration),
                        ),
                        lastNoteId,
                    );
                    return this.finishTechniqueNote(
                        lastNoteId, note, effectiveDuration, str, connectableAfter,
                    );
            }
        }

        // 普通拨弦（或技法但无前一个活跃音符）
        // 先停止同弦上一个活跃音符，避免与旧音叠加
        if (lastNoteId) {
            this.guitar.stopNote(lastNoteId);
        }
        const noteId = this.guitar.playNote({
            frequency,
            duration: ringDuration,
            volume: effectiveVolume,
            string: str,
            mute: !!note.deadNote,
            palmMute: !!note.palmMute,
            dynamics,
            fret: note.fret ?? 0,
        });
        this.stringNoteMap.set(str, noteId);
        this.stringConnectable.set(str, canSourceTechnique(note));
        return noteId;
    }

    /**
     * 技法音符的奏法收尾。
     * 击/勾/滑复用前一个同弦音；推/揉弦作用于自身新拨响的音。
     * 闷音/断音的时值与音色修正落到当前正在发声的音符上，避免被技法分支静默吞掉。
     *
     * `connectable` 表示当前发声的音符还能不能继续连接下一个技法：
     * 目标音自己带 palmMute/断音时，会把复用中的缓冲压短，后续也得重拨。
     */
    private finishTechniqueNote(
        noteId: symbol,
        note: Note,
        durationSec: number,
        str: number,
        connectable: boolean,
    ): symbol {
        this.stringNoteMap.set(str, noteId);
        this.stringConnectable.set(str, connectable);
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
        this.stringConnectable.clear();

        // 构建播放调度（纯函数层：时值→秒、扫弦/琶音、音量补偿、空小节兜底）
        const { events, totalDurationMs, silenceSpansMs } = buildSchedule(this.measures, this.bpm);
        // 源音要撑到后续同弦技法目标音的结尾，否则击/勾/滑只剩一点残余。
        // 休止/空小节会打断连接，避免把源音拉过整段静默。
        const ringSecs = computeTechniqueRing(events, silenceSpansMs);
        // 短静默内源音缓冲区可能还没过期，必须显式要求目标重拨
        const forceReplucks = computeForceRepluck(events, silenceSpansMs);

        // 调度播放所有音符；代次校验同时挡住 stop/pause 后残留的旧回调
        events.forEach((item, index) => {
            this.eventTimers.push(setTimeout(() => {
                if (this.runId !== runId || this.state !== 'playing') return;
                this.playNote(
                    item.note,
                    item.duration,
                    item.volume,
                    item.dynamics,
                    ringSecs[index],
                    forceReplucks[index],
                );
            }, item.delayMs));
        });

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
