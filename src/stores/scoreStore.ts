/**
 * scoreStore — 乐谱数据状态管理
 *
 * 类似 Pinia store 的命名风格，
 * 集中管理 TabScore 及相关操作。
 */

import type { TabScore, Measure, Note, Tuning } from '../types/index.ts';
import { STANDARD_TUNING } from '../types/index.ts';
import { createEmptyMeasure } from '../tabRenderer.ts';

export const scoreStore = {
    /** 乐谱数据 */
    score: {
        title: '--',
        artist: '',
        tuning: { ...STANDARD_TUNING },
        bpm: 120,
        measures: [] as Measure[],
        key: 'C',
        timeSignature: '4/4',
        remarks: '',
    } as TabScore,

    /** 当前选中的小节索引 */
    selectedMeasure: 0,
    /** 当前选中的弦号 (1-6) */
    selectedString: 1,

    // ============================================================
    // Actions
    // ============================================================

    /** 获取当前活动小节（如果无小节则自动创建） */
    getActiveMeasure(): Measure {
        const { score } = this;
        if (score.measures.length === 0) {
            const m = createEmptyMeasure(0);
            const [num, den] = score.timeSignature.split('/').map(Number);
            m.timeSignatureNumerator = num;
            m.timeSignatureDenominator = den;
            score.measures.push(m);
            return m;
        }
        return score.measures[score.measures.length - 1];
    },

    /** 添加新小节 */
    addMeasure(): number {
        const i = this.score.measures.length;
        const m = createEmptyMeasure(i);
        const [num, den] = this.score.timeSignature.split('/').map(Number);
        m.timeSignatureNumerator = num;
        m.timeSignatureDenominator = den;
        this.score.measures.push(m);
        return i + 1;
    },

    /** 删除最后一个小节 */
    deleteLastMeasure(): boolean {
        if (this.score.measures.length === 0) return false;
        this.score.measures.pop();
        return true;
    },

    /** 清空所有小节 */
    clear(): void {
        this.score.measures = [];
    },

    /** 添加音符到当前小节（单音/休止符/和弦音符统一走此方法） */
    addNote(note: Note): void {
        const measure = this.getActiveMeasure();
        measure.notes.push(note);
    },

    /** 添加休止符到当前小节 */
    addRest(duration: number): void {
        const measure = this.getActiveMeasure();
        if (!measure.notes) measure.notes = [];
        measure.notes.push({ isRest: true, duration } as Note);
    },

    /** 设置调弦 */
    setTuning(tuning: Tuning): void {
        this.score.tuning = { ...tuning };
    },

    /** 设置单根弦的调弦 */
    setStringTuning(stringNum: number, noteName: string): void {
        const key = `string${stringNum}` as keyof Tuning;
        this.score.tuning[key] = noteName;
    },

    /** 设置 BPM */
    setBpm(bpm: number): void {
        this.score.bpm = Math.max(20, Math.min(300, bpm));
    },

    /** 设置调性 */
    setKey(key: string): void {
        this.score.key = key;
    },

    /** 设置全局拍号并同步到所有小节 */
    setTimeSignature(sig: string): void {
        this.score.timeSignature = sig;
        const [num, den] = sig.split('/').map(Number);
        for (const m of this.score.measures) {
            m.timeSignatureNumerator = num;
            m.timeSignatureDenominator = den;
        }
    },
};
