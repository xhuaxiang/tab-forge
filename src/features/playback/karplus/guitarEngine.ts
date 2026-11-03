/**
 * GuitarEngine - 吉他合成引擎
 *
 * 职责:
 *   1. 管理 AudioContext 生命周期
 *   2. 调用 karplusStrong.ts 生成琴弦振动缓冲区
 *   3. 将缓冲区连接到 AudioContext 输出（含琴体共鸣滤波 + 混响）
 *   4. 管理音符生命周期（播放、停止、清理）
 *   5. 演奏技巧支持（击弦、勾弦、滑弦）
 *
 * 不负责:
 *   - 音色算法本身（由 karplusStrong.ts 负责）
 *   - 乐谱调度（由 audioEngine.ts 负责）
 */

import { generateStringData, toAudioBuffer, getBodyFilterPreset } from './karplusStrong.ts';
import { KARPLUS_ARTICULATION } from '../../../core/config.ts';

/** source.stop 相对淡出结束的余量（秒），确保淡出完全生效 */
const STOP_MARGIN_SEC = 0.005;
/** 节点断开的延迟余量（秒），等 source.stop 与淡出走完 */
const DISCONNECT_MARGIN_SEC = 0.05;

export interface NoteOptions {
    frequency?: number;
    duration?: number;
    volume?: number;
    string?: number;
    /** 制音/死音：极短、只剩打击感 */
    mute?: boolean;
    /** 手掌闷音：短促、暗，但仍保留音高 */
    palmMute?: boolean;
    /** 拨弦力度：影响激励亮度、起音瞬态、阻尼与延音 */
    dynamics?: 'soft' | 'accent';
    /** 把位（0 = 空弦）：影响拨弦位置与延音 */
    fret?: number;
    onEnd?: () => void;
}

interface ActiveNote {
    source: AudioBufferSourceNode | null;
    gain: GainNode;
    /** 琴体低通：技法连接时手掌闷音要把它压暗 */
    bodyFilter: BiquadFilterNode | null;
    nodes: AudioNode[];
    startTime: number;
    duration: number;
    frequency: number;
}

export class GuitarEngine {
    private ctx: AudioContext | null = null;
    private activeNotes: Map<symbol, ActiveNote> = new Map();
    private masterGain: GainNode | null = null;

    init(): AudioContext {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = KARPLUS_ARTICULATION.masterGain;
            this.masterGain.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.ctx;
    }

    getContext(): AudioContext | null {
        return this.ctx;
    }

    playNote(options: NoteOptions = {}): symbol {
        const ctx = this.ctx;
        if (!ctx || !this.masterGain) throw new Error('请先调用 init()');

        const {
            frequency = 440,
            duration = 0.8,
            volume = 0.5,
            string: stringNum,
            mute = false,
            palmMute = false,
            dynamics,
            fret,
            onEnd = null,
        } = options;

        if (frequency <= 0) {
            const id = Symbol('note');
            setTimeout(() => { if (onEnd) onEnd(); }, 50);
            return id;
        }

        const now = ctx.currentTime;

        // 音符发声时长 = 记谱时值 + 短衰减尾音。
        // 技法是"音高调制"，只作用于播放中的音符，不延长时值；
        // 这里只用短尾音让拨弦自然衰减，避免之前"统一拉长到 1.2s"导致的时值错乱。
        const soundDur = Math.max(duration, 0.05) + 0.2;

        // ---- 1) 调用 Karplus-Strong 生成琴弦振动 ----
        // 算法层输出裸采样数据，这里包装为 AudioBuffer
        const ks = generateStringData({
            frequency,
            duration: soundDur,
            sampleRate: ctx.sampleRate,
            string: stringNum,
            mute,
            palmMute,
            // 记谱时值传给 KS 做衰减：短音快速收干、长音自然延音
            sustain: duration,
            dynamics,
            fret,
        });
        const buffer = toAudioBuffer(ctx, ks);

        // ---- 2) 构建音频信号链 ----
        // mixGain 承载音量与技法增益；envGain 只负责音符收尾的释音包络。
        // 两者分开，技法在起音后改写 mixGain 时不会让释音把电平拉回初始 volume。
        const mixGain = ctx.createGain();
        mixGain.gain.value = volume;
        const envGain = ctx.createGain();
        envGain.gain.value = 1;
        mixGain.connect(envGain);
        envGain.connect(this.masterGain);

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        // 琴体共鸣滤波器组
        const preset = getBodyFilterPreset(stringNum);
        const bodyFilter = ctx.createBiquadFilter();
        bodyFilter.type = 'lowpass';
        bodyFilter.frequency.value = mute
            ? 1000
            : palmMute
                ? Math.min(preset.lowpassFreq, KARPLUS_ARTICULATION.palmMuteLowpassFreq)
                : preset.lowpassFreq;
        bodyFilter.Q.value = 0.5;

        const resonance = ctx.createBiquadFilter();
        resonance.type = 'peaking';
        resonance.frequency.value = preset.resonanceFreq;
        resonance.Q.value = (stringNum ?? 3) <= 2 ? 1.5 : 1.0;
        resonance.gain.value = mute
            ? 2.0
            : palmMute
                ? Math.min(preset.resonanceGain, KARPLUS_ARTICULATION.palmMuteResonanceGain)
                : preset.resonanceGain;

        source.connect(bodyFilter);
        bodyFilter.connect(resonance);
        resonance.connect(mixGain);

        // 释音包络：在发声结束前淡出，避免 source.stop 在非零采样处硬切。
        // 必须先用 setValueAtTime 锚定 releaseStart：新建 GainNode 上直接
        // exponentialRampToValueAtTime 没有前置事件，会从调用时刻（≈now）
        // 开始淡，整段音符提前收干。
        const stopTime = now + soundDur;
        const releaseSec = Math.min(KARPLUS_ARTICULATION.releaseSec, soundDur);
        const releaseStart = stopTime - releaseSec;
        envGain.gain.setValueAtTime(1, releaseStart);
        envGain.gain.exponentialRampToValueAtTime(0.001, stopTime);

        source.start(now);
        // 按发声时长截止；增益已在 stopTime 前淡到 0.001
        source.stop(stopTime);

        const allNodes: AudioNode[] = [source, bodyFilter, resonance, mixGain, envGain];

        // ---- 3) 混响（单延迟线） ----
        // 手掌闷音要干、要收紧，不加混响
        if (!mute && !palmMute) {
            const delay = ctx.createDelay(0.1);
            delay.delayTime.value = 0.025;
            const delayGain = ctx.createGain();
            // 回响压到极低，音符更干、前后音更分得开
            delayGain.gain.value = volume * 0.04;
            // 从包络之后取送：收尾淡出时混响尾音一起收
            envGain.connect(delay);
            delay.connect(delayGain);
            delayGain.connect(this.masterGain);
            allNodes.push(delay, delayGain);
            setTimeout(() => {
                try { delay.disconnect(); delayGain.disconnect(); } catch {}
            }, (duration + 0.5) * 1000);
        }

        // ---- 4) 记录 & 清理 ----
        const noteId = Symbol('note');
        this.activeNotes.set(noteId, {
            source,
            gain: mixGain,
            bodyFilter,
            nodes: allNodes,
            startTime: now,
            duration: soundDur,
            frequency,
        });

        const cleanupMs = (soundDur + 0.5) * 1000;
        setTimeout(() => {
            try {
                for (const n of allNodes) {
                    if (n instanceof AudioBufferSourceNode) {
                        try { n.stop(now); } catch {}
                    }
                    try { n.disconnect(); } catch {}
                }
            } catch {}
            this.activeNotes.delete(noteId);
            if (onEnd) onEnd();
        }, cleanupMs);

        return noteId;
    }

    // ============================================================
    // 演奏技巧
    // ============================================================

    hammerOn(fromFreq: number, toFreq: number, noteId: symbol | null = null): symbol {
        if (!noteId || !this.activeNotes.has(noteId)) {
            return this.playNote({ frequency: toFreq, duration: 0.6, volume: 0.6 });
        }
        const note = this.activeNotes.get(noteId)!;
        const ctx = this.ctx!;
        const now = ctx.currentTime;
        if (note.source) {
            note.source.playbackRate.setValueAtTime(1, now);
            note.source.playbackRate.exponentialRampToValueAtTime(toFreq / fromFreq, now + 0.025);
        }
        note.gain.gain.setValueAtTime(0.6, now);
        note.frequency = toFreq;
        return noteId;
    }

    pullOff(fromFreq: number, toFreq: number, noteId: symbol | null = null): symbol {
        if (!noteId || !this.activeNotes.has(noteId)) {
            return this.playNote({ frequency: toFreq, duration: 0.5, volume: 0.5 });
        }
        const note = this.activeNotes.get(noteId)!;
        const ctx = this.ctx!;
        const now = ctx.currentTime;
        if (note.source) {
            note.source.playbackRate.cancelScheduledValues(now);
            note.source.playbackRate.setValueAtTime(1, now);
            note.source.playbackRate.exponentialRampToValueAtTime(toFreq / fromFreq, now + 0.02);
        }
        note.gain.gain.setValueAtTime(0.4, now);
        note.frequency = toFreq;
        return noteId;
    }

    slideTo(toFreq: number, slideDuration: number = 0.15, noteId: symbol | null = null): symbol {
        if (!noteId || !this.activeNotes.has(noteId)) {
            return this.playNote({ frequency: toFreq, duration: 0.6, volume: 0.6 });
        }
        const note = this.activeNotes.get(noteId)!;
        const ctx = this.ctx!;
        const now = ctx.currentTime;
        if (note.source) {
            note.source.playbackRate.cancelScheduledValues(now);
            note.source.playbackRate.setValueAtTime(1, now);
            note.source.playbackRate.exponentialRampToValueAtTime(toFreq / note.frequency, now + slideDuration);
        }
        note.gain.gain.setValueAtTime(0.6, now);
        note.frequency = toFreq;
        return noteId;
    }

    /**
     * 推弦：在该音符自身音高基础上向上弯曲 semitones 个半音。
     *
     * 与 hammerOn/pullOff/slide 的「技法连接」不同：推弦是技法音符**自己发声**。
     * 前一个同弦音可能已经停止或在别的弦上，不能借用它的声音。
     * 全部用 AudioParam 的绝对时间排程，不走 setTimeout，避免与调度层抢时序。
     *
     * @param semitones 推弦幅度（半音，向上为正）
     * @param holdSec   从拨弦起算的持音时长（用于计算回弹时机）
     * @param release   是否在时值末尾回弹到原音高
     */
    bendNote(noteId: symbol, semitones: number, holdSec: number, release = false): void {
        const note = this.activeNotes.get(noteId);
        if (!note || !note.source || !this.ctx || semitones === 0) return;
        const now = this.ctx.currentTime;
        const rate = note.source.playbackRate;
        const target = Math.pow(2, semitones / 12);
        const start = now + KARPLUS_ARTICULATION.bendStartSec;
        const peak = start + KARPLUS_ARTICULATION.bendTimeSec;

        rate.cancelScheduledValues(now);
        rate.setValueAtTime(1, now);
        rate.setValueAtTime(1, start);
        rate.exponentialRampToValueAtTime(target, peak);

        if (release) {
            // 回弹不能早于推弦到达峰值，否则会被吞掉
            const releaseStart = Math.max(
                peak,
                now + holdSec - KARPLUS_ARTICULATION.bendReleaseLeadSec,
            );
            rate.setValueAtTime(target, releaseStart);
            rate.exponentialRampToValueAtTime(
                1,
                releaseStart + KARPLUS_ARTICULATION.bendReleaseTimeSec,
            );
        }

        // 推弦时稍微增大音量模拟张力增加
        note.gain.gain.setValueAtTime(0.65, now);
        note.frequency *= target;
    }

    /**
     * 揉弦：通过 LFO 调制 playbackRate 产生音高波动。
     * @param startDelaySec 拨弦后多久开始揉（秒），避开起音
     */
    vibrato(noteId: symbol, depth: number = 0.015, rate: number = 5.5, startDelaySec = 0): void {
        const note = this.activeNotes.get(noteId);
        if (!note || !note.source || !this.ctx) return;
        const ctx = this.ctx;
        const now = ctx.currentTime;

        // 低频振荡器 → 增益 → playbackRate，产生周期性音高波动
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = rate;   // 揉弦频率 ~5.5Hz

        const lfoGain = ctx.createGain();
        lfoGain.gain.value = depth;   // 调制深度（围绕当前 playbackRate 波动 ±depth）

        lfo.connect(lfoGain);
        lfoGain.connect(note.source.playbackRate);

        lfo.start(now + Math.max(0, startDelaySec));
        note.nodes.push(lfo, lfoGain);
    }

    /**
     * 对已发声的音符施加奏法收尾。
     *
     * 击弦/勾弦/滑弦复用上一个同弦音；推弦/揉弦作用于自身的新起音。
     * 技法都不重新生成缓冲区，所以闷音/断音无法通过重新生成实现，只能直接写在当前音的包络上。
     * @param afterSec 从当前时刻起多久开始快速淡出（秒）
     * @param volumeFactor 起始音量系数（手掌闷音）
     * @param darken 是否压低琴体低通的截止频率（手掌闷音音色）
     */
    dampNote(noteId: symbol, afterSec: number, volumeFactor = 1, darken = false): void {
        const note = this.activeNotes.get(noteId);
        if (!note || !this.ctx) return;
        const now = this.ctx.currentTime;
        const end = now + Math.max(0.02, afterSec);
        try {
            if (darken && note.bodyFilter) {
                const freq = note.bodyFilter.frequency;
                freq.cancelScheduledValues(now);
                freq.setValueAtTime(freq.value, now);
                freq.exponentialRampToValueAtTime(
                    Math.max(200, KARPLUS_ARTICULATION.palmMuteLowpassFreq),
                    now + 0.03,
                );
            }
            const gain = note.gain.gain;
            const level = Math.max(0.001, gain.value * volumeFactor);
            gain.cancelScheduledValues(now);
            gain.setValueAtTime(level, now);
            gain.setValueAtTime(level, end);
            gain.exponentialRampToValueAtTime(0.001, end + 0.03);
        } catch {}
    }

    // ============================================================
    // 停止 & 释放
    // ============================================================

    /** 停止单个活跃音符（先淡出，再停 source） */
    stopNote(noteId: symbol): void {
        const note = this.activeNotes.get(noteId);
        if (!note || !this.ctx) return;
        const now = this.ctx.currentTime;
        const fadeSec = KARPLUS_ARTICULATION.releaseSec;
        try {
            // 顺序必须反过来：先让 gain 淡到接近 0，再停 source。
            // 必须先读 gain.value 再 cancel：cancelScheduledValues 会删掉进行中的
            // release ramp，参数回退到上一个 setValueAtTime，再读就会从被抬高的
            // 电平起淡，产生一次上跳。
            const gain = note.gain.gain;
            const current = Math.max(0.001, gain.value);
            gain.cancelScheduledValues(now);
            gain.setValueAtTime(current, now);
            gain.exponentialRampToValueAtTime(0.001, now + fadeSec);
            if (note.source) {
                try { note.source.stop(now + fadeSec + STOP_MARGIN_SEC); } catch {}
            }
        } catch {}
        this.activeNotes.delete(noteId);
        // 延迟断开节点，等淡出与 source.stop 完成
        setTimeout(() => {
            for (const n of note.nodes) {
                try { n.disconnect(); } catch {}
            }
        }, (fadeSec + DISCONNECT_MARGIN_SEC) * 1000);
    }

    stopAll(): void {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const fadeSec = KARPLUS_ARTICULATION.releaseSec;
        for (const [, note] of this.activeNotes) {
            try {
                const gain = note.gain.gain;
                // 同 stopNote：先读当前电平，再清掉进行中的 release
                const current = Math.max(0.001, gain.value);
                gain.cancelScheduledValues(now);
                gain.setValueAtTime(current, now);
                gain.exponentialRampToValueAtTime(0.001, now + fadeSec);
                if (note.source) {
                    note.source.stop(now + fadeSec + STOP_MARGIN_SEC);
                }
            } catch {}
        }
        this.activeNotes.clear();
    }

    dispose(): void {
        this.stopAll();
        if (this.ctx) {
            this.ctx.close();
            this.ctx = null;
        }
    }
}
