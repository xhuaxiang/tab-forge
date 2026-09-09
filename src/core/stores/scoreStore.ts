/**
 * scoreStore — 乐谱数据状态管理
 *
 * 类似 Pinia store 的命名风格，
 * 集中管理 TabScore 及相关操作。
 */

import type { TabScore, Measure, Note, Tuning } from '../types/index.ts';
import { locateSlotAt, measureTotalBeats, canAddToMeasure, createEmptyMeasure } from '../utils/measureUtils.ts';
import { applyNoteChange, muteNoteGroup } from '../utils/measureEdit.ts';
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

    /** 当前选中的小节索引（null = 未选中；未选中时添加操作落到末尾小节） */
    selectedMeasure: null as number | null,
    /** 当前选中的弦号 (1-6) */
    selectedString: 1,

    // ============================================================
    // 变更通知（集中触发渲染，eventHandlers 不再手动 render()）
    // ============================================================

    /** 数据变更回调（由 state 注入 render，整谱重渲染用） */
    onChange: null as (() => void) | null,
    /** 选中小节变化回调（轻量：仅刷新高亮/导航，不整谱重渲染） */
    onSelectChange: null as (() => void) | null,
    /** 批量静默深度：>0 时不触发通知，归零时通知一次 */
    _batchDepth: 0,

    /** 注入数据变更回调 */
    setOnChange(fn: () => void): void {
        this.onChange = fn;
    },

    /** 注入选中变化回调 */
    setOnSelectChange(fn: () => void): void {
        this.onSelectChange = fn;
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

    /** 当前实际生效的活动小节索引（选中或末尾小节；空谱返回 0） */
    activeMeasureIndex(): number {
        const len = this.score.measures.length;
        if (len === 0) return 0;
        if (this.selectedMeasure === null) return len - 1;
        return Math.min(Math.max(this.selectedMeasure, 0), len - 1);
    },

    /** 选中某一小节（null 取消选中）。选中变化走轻量 onSelectChange，不整谱重渲染 */
    selectMeasure(index: number | null): number | null {
        const len = this.score.measures.length;
        if (len === 0 || index === null) {
            if (this.selectedMeasure !== null) {
                this.selectedMeasure = null;
                this.onSelectChange?.();
            }
            return null;
        }
        const clamped = Math.max(0, Math.min(index, len - 1));
        if (this.selectedMeasure !== clamped) {
            this.selectedMeasure = clamped;
            this.onSelectChange?.();
        }
        return clamped;
    },

    /** 获取当前活动（选中或末尾）小节；空谱时自动创建第一个小节 */
    getActiveMeasure(): Measure {
        const { score } = this;
        if (score.measures.length === 0) {
            const m = createEmptyMeasure(0);
            const [num, den] = score.timeSignature.split('/').map(Number);
            m.timeSignatureNumerator = num;
            m.timeSignatureDenominator = den;
            score.measures.push(m);
            this.selectedMeasure = null;
            return m;
        }
        return score.measures[this.activeMeasureIndex()];
    },

    /** 添加新小节（追加到末尾；不自动选中，默认仍向末尾小节添加） */
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

    /** 删除最后一个小节（选中越界时取消选中） */
    deleteLastMeasure(): boolean {
        if (this.score.measures.length === 0) return false;
        this.score.measures.pop();
        if (this.selectedMeasure !== null && this.selectedMeasure >= this.score.measures.length) {
            this.selectedMeasure = null;
        }
        this._notify();
        return true;
    },

    /** 清空所有小节 */
    clear(): void {
        this.score.measures = [];
        this.selectedMeasure = null;
        this._notify();
    },

    /** 添加音符到当前小节（单音/休止符/和弦音符统一走此方法） */
    addNote(note: Note): void {
        const measure = this.getActiveMeasure();
        measure.notes.push(note);
        this._notify();
    },

    /**
     * 用拍平音符重建整谱（AI 生成 / Prompt 调试结果导入）。
     * 按 chordGroup 分组成拍位，按拍号容量填满切小节，末尾补足到 minMeasures 小节。
     * @returns 实际写入的音符数
     */
    loadNotes(notes: Note[], minMeasures: number): number {
        this.beginBatch();
        this.clear();
        if (this.score.measures.length === 0) this.addMeasure();

        // 按 chordGroup 分组成拍位：和弦整体进一小节，不被切开，容量按拍位计
        const slots: Note[][] = [];
        let current: Note[] = [];
        for (const n of notes) {
            if (n.chordGroup !== undefined && current.length > 0 && current[0].chordGroup === n.chordGroup) {
                current.push(n);
            } else {
                if (current.length > 0) slots.push(current);
                current = [n];
            }
        }
        if (current.length > 0) slots.push(current);

        let written = 0;
        for (const slot of slots) {
            const dur = slot[0].duration || 0.25;
            let measure = this.getActiveMeasure();
            if (!canAddToMeasure(measure, dur)) {
                this.addMeasure();
                measure = this.getActiveMeasure();
            }
            if (slot[0].isRest) {
                this.addRest(dur);
                written++;
                continue;
            }
            // 和弦内同弦去重（避免同一 X 上音符重叠），其余按序写入
            const seenStrings = new Set<number>();
            for (const n of slot) {
                if (n.isRest || n.string === undefined) continue;
                if (seenStrings.has(n.string)) continue;
                seenStrings.add(n.string);
                this.addNote(n);
                written++;
            }
        }

        // 补足小节数（AI 按拍容量重排后可能少于配置数）
        while (this.score.measures.length < minMeasures) {
            this.addMeasure();
        }
        this.endBatch(); // 批量结束，统一渲染一次
        return written;
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

    /** 原位修改某小节的音符（单音拍整拍替换 / 和弦内单弦替换，保留原拍时值） */
    updateNoteAt(measureIndex: number, noteIndex: number, note: Note): { ok: boolean; reason?: string } {
        const measure = this.score.measures[measureIndex];
        if (!measure) return { ok: false, reason: '小节不存在' };
        const r = applyNoteChange(measure, noteIndex, note);
        if (!r.ok || !r.notes) return { ok: false, reason: r.reason ?? '修改失败' };
        measure.notes = r.notes;
        this._notify();
        return { ok: true };
    },

    /** 把某小节的整拍（单音/和弦）静音为休止符，保留时值 */
    muteNoteAt(measureIndex: number, noteIndex: number): { ok: boolean; reason?: string } {
        const measure = this.score.measures[measureIndex];
        if (!measure) return { ok: false, reason: '小节不存在' };
        const r = muteNoteGroup(measure, noteIndex);
        if (!r.ok || !r.notes) return { ok: false, reason: r.reason ?? '删除失败' };
        measure.notes = r.notes;
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
