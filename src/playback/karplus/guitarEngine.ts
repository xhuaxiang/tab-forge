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

export interface NoteOptions {
    frequency?: number;
    duration?: number;
    volume?: number;
    string?: number;
    mute?: boolean;
    onEnd?: () => void;
}

interface ActiveNote {
    source: AudioBufferSourceNode | null;
    gain: GainNode;
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
            this.masterGain.gain.value = 0.5;
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
            // 记谱时值传给 KS 做衰减：短音快速收干、长音自然延音
            sustain: duration,
        });
        const buffer = toAudioBuffer(ctx, ks);

        // ---- 2) 构建音频信号链 ----
        const mixGain = ctx.createGain();
        mixGain.gain.value = volume;
        mixGain.connect(this.masterGain);

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        // 琴体共鸣滤波器组
        const preset = getBodyFilterPreset(stringNum);
        const bodyFilter = ctx.createBiquadFilter();
        bodyFilter.type = 'lowpass';
        bodyFilter.frequency.value = mute ? 1000 : preset.lowpassFreq;
        bodyFilter.Q.value = 0.5;

        const resonance = ctx.createBiquadFilter();
        resonance.type = 'peaking';
        resonance.frequency.value = preset.resonanceFreq;
        resonance.Q.value = (stringNum ?? 3) <= 2 ? 1.5 : 1.0;
        resonance.gain.value = mute ? 2.0 : preset.resonanceGain;

        source.connect(bodyFilter);
        bodyFilter.connect(resonance);
        resonance.connect(mixGain);

        source.start(now);
        // 按发声时长截止（自然衰减尾音后静音）
        source.stop(now + soundDur);

        const allNodes: AudioNode[] = [source, bodyFilter, resonance, mixGain];

        // ---- 3) 混响（单延迟线） ----
        if (!mute) {
            const delay = ctx.createDelay(0.1);
            delay.delayTime.value = 0.025;
            const delayGain = ctx.createGain();
            // 回响压到极低，音符更干、前后音更分得开
            delayGain.gain.value = volume * 0.04;
            mixGain.connect(delay);
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

    /** 推弦：从当前频率向上弯曲到目标频率 */
    bendTo(toFreq: number, bendDuration: number = 0.12, noteId: symbol | null = null): symbol {
        if (!noteId || !this.activeNotes.has(noteId)) {
            return this.playNote({ frequency: toFreq, duration: 0.6, volume: 0.6 });
        }
        const note = this.activeNotes.get(noteId)!;
        const ctx = this.ctx!;
        const now = ctx.currentTime;
        if (note.source) {
            note.source.playbackRate.cancelScheduledValues(now);
            note.source.playbackRate.setValueAtTime(1, now);
            // 推弦只向上弯曲，不回落
            note.source.playbackRate.exponentialRampToValueAtTime(toFreq / note.frequency, now + bendDuration);
        }
        // 推弦时稍微增大音量模拟张力增加
        note.gain.gain.setValueAtTime(0.65, now);
        note.frequency = toFreq;
        return noteId;
    }

    /** 揉弦：通过 LFO 调制 playbackRate 产生音高波动 */
    vibrato(noteId: symbol, depth: number = 0.015, rate: number = 5.5): void {
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

        lfo.start(now);
        note.nodes.push(lfo, lfoGain);
    }

    // ============================================================
    // 停止 & 释放
    // ============================================================

    /** 停止单个活跃音符（快速淡出） */
    stopNote(noteId: symbol): void {
        const note = this.activeNotes.get(noteId);
        if (!note || !this.ctx) return;
        const now = this.ctx.currentTime;
        try {
            if (note.source) {
                try { note.source.stop(now); } catch {}
            }
            note.gain.gain.cancelScheduledValues(now);
            note.gain.gain.setValueAtTime(note.gain.gain.value, now);
            note.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        } catch {}
        this.activeNotes.delete(noteId);
        // 延迟断开节点
        setTimeout(() => {
            for (const n of note.nodes) {
                try { n.disconnect(); } catch {}
            }
        }, 50);
    }

    stopAll(): void {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        for (const [, note] of this.activeNotes) {
            try {
                if (note.source) {
                    note.source.stop(now);
                }
                note.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
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
