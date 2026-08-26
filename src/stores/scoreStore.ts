/**
 * scoreStore — 乐谱数据状态管理
 *
 * 类似 Pinia store 的命名风格，
 * 集中管理 TabScore 及相关操作。
 */

import type { TabScore, Measure, Note, Tuning } from '../types/index.ts';
import { locateSlotAt, measureTotalBeats, canAddToMeasure, createEmptyMeasure } from '../utils/measureUtils.ts';
import { SCORE_DEFAULTS } from '../config.ts';

export const scoreStore = {
    /** 乐谱数据 */
    score: {
        title: '--',
        artist: '',
        tuning: { ...SCORE_DEFAULTS.tuning },
        bpm: SCORE_DEFAULTS.bpm,
        measures: [] as Measure[],
        key: SCORE_DEFAULTS.key,
        timeSignature: SCORE_DEFAULTS.timeSignature,
        remarks: '',
    } as TabScore,

    /** 当前选中的小节索引 */
    selectedMeasure: 0,
    /** 当前选中的弦号 (1-6) */
    selectedString: 1,

    // ============================================================
    // 变更通知（集中触发渲染，eventHandlers 不再手动 render()）
    // ============================================================

    /** 数据变更回调（由 state 注入 render） */
    onChange: null as (() => void) | null,
    /** 批量静默深度：>0 时不触发通知，归零时通知一次 */
    _batchDepth: 0,

    /** 注入变更回调 */
    setOnChange(fn: () => void): void {
        this.onChange = fn;
    },

    /** 开始批量变更（如 AI 生成，期间不逐条渲染） */
    beginBatch(): void {
        this._batchDepth++;
    },

    /** 结束批量变更，归零时通知一次 */
    endBatch(): void {
        this._batchDepth = Math.max(0, this._batchDepth - 1);
        if (this._batchDepth === 0) this._notify();
    },

    /** 通知渲染（批量静默中不通知） */
    _notify(): void {
        if (this._batchDepth === 0) this.onChange?.();
    },

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
        this._notify();
        return i + 1;
    },

    /** 删除最后一个小节 */
    deleteLastMeasure(): boolean {
        if (this.score.measures.length === 0) return false;
        this.score.measures.pop();
        this._notify();
        return true;
    },

    /** 清空所有小节 */
    clear(): void {
        this.score.measures = [];
        this._notify();
    },

    /** 添加音符到当前小节（单音/休止符/和弦音符统一走此方法） */
    addNote(note: Note): void {
        const measure = this.getActiveMeasure();
        measure.notes.push(note);
        this._notify();
    },

    /** 添加休止符到当前小节 */
    addRest(duration: number): void {
        const measure = this.getActiveMeasure();
        if (!measure.notes) measure.notes = [];
        measure.notes.push({ isRest: true, duration } as Note);
        this._notify();
    },

    /** 在指定小节、指定拍偏移处插入音符（供 alphaTab 点击编辑） */
    insertNoteAt(measureIndex: number, beatOffset: number, note: Note): { ok: boolean; reason?: string } {
        const measure = this.score.measures[measureIndex];
        if (!measure) return { ok: false, reason: '小节不存在' };

        const loc = locateSlotAt(measure, beatOffset);
        const notes = measure.notes;

        // 目标 slot 是休止 → 替换（「空白拍」场景）
        if ((loc.kind === 'slot' || loc.kind === 'inside') && loc.slot[0].isRest) {
            const first = loc.slot[0];
            const replaceIndex = loc.kind === 'slot' ? loc.index : loc.afterIndex - 1;
            const cap = measure.timeSignatureNumerator * (1 / measure.timeSignatureDenominator);
            const total = measureTotalBeats(measure);
            if (total - first.duration + note.duration > cap + 0.001) {
                return { ok: false, reason: '时值超出小节容量' };
            }
            notes.splice(replaceIndex, 1, note);
            this._notify();
            return { ok: true };
        }

        // 目标 slot 是音符 → 合并进该 slot（单音变和弦 / 和弦追加）
        if (loc.kind === 'slot') {
            const r = appendToSlot(measure, loc.index + loc.slot.length, loc.slot, note);
            if (r.ok) this._notify();
            return r;
        }
        if (loc.kind === 'inside') {
            const r = appendToSlot(measure, loc.afterIndex, loc.slot, note);
            if (r.ok) this._notify();
            return r;
        }

        // 超出所有内容（空小节隐式全音符休止 / 尾部）
        if (!canAddToMeasure(measure, note.duration)) return { ok: false, reason: '节拍已满' };
        notes.push(note);
        this._notify();
        return { ok: true };
    },

    /** 设置调弦 */
    setTuning(tuning: Tuning): void {
        this.score.tuning = { ...tuning };
        this._notify();
    },

    /** 设置单根弦的调弦 */
    setStringTuning(stringNum: number, noteName: string): void {
        const key = `string${stringNum}` as keyof Tuning;
        this.score.tuning[key] = noteName;
        this._notify();
    },

    /** 设置 BPM */
    setBpm(bpm: number): void {
        this.score.bpm = Math.max(20, Math.min(300, bpm));
        this._notify();
    },

    /** 设置调性 */
    setKey(key: string): void {
        this.score.key = key;
        this._notify();
    },

    /** 设置全局拍号并同步到所有小节 */
    setTimeSignature(sig: string): void {
        this.score.timeSignature = sig;
        const [num, den] = sig.split('/').map(Number);
        for (const m of this.score.measures) {
            m.timeSignatureNumerator = num;
            m.timeSignatureDenominator = den;
        }
        this._notify();
    },
};

/** 把音符合并进已有音符 slot（单音→和弦或和弦追加） */
function appendToSlot(measure: Measure, afterIndex: number, slot: Note[], note: Note): { ok: boolean; reason?: string } {
    if (slot.some(n => n.string === note.string)) return { ok: false, reason: '该弦已有音符' };
    if (slot[0].chordGroup !== undefined) {
        note.chordGroup = slot[0].chordGroup;
    } else {
        const g = Date.now();
        for (const n of slot) n.chordGroup = g;
        note.chordGroup = g;
    }
    // 和弦内音符共享 slot 时值
    note.duration = slot[0].duration;
    measure.notes.splice(afterIndex, 0, note);
    return { ok: true };
}
