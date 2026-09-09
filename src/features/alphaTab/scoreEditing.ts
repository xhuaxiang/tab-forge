/**
 * scoreEditing — alphaTab 谱面直接编辑
 *
 * 把 alphaTab 渲染的谱面点击事件映射回应用的编辑表单与 scoreStore：
 * - 点击已有音符 → 载入表单（弦/品/时值/技法）
 * - 点击空白拍 → 用表单当前值在该拍插入音符
 *
 * 纯映射函数在 scoreMapping.ts（可单测），本文件负责 DOM/表单/点击逻辑，
 * 由 alphaTabRenderer 在容器 click 时调用 handleScoreClick。
 */

import type { model } from '@coderline/alphatab';
import type { Note, NoteDuration } from '../../core/types/index.ts';
import { scoreStore } from '../../core/stores/scoreStore.ts';
import { uiStore } from '../../core/stores/uiStore.ts';
import { $, setStatus, getSearchSelectValue, durationName } from '../../app/state.ts';
import { alphaStringToAppString, alphaDurationToAppDuration, beatOffsetInMeasure, detectTechnique, type AppTechnique } from '../../core/utils/scoreMapping.ts';
import { findNoteAtBeat } from '../../core/utils/measureEdit.ts';

export type { AppTechnique } from '../../core/utils/scoreMapping.ts';

export interface ScoreClickHit {
    beat: model.Beat | null;
    note: model.Note | null;
}

// ============================================================
// 表单辅助（eventHandlers 复用）
// ============================================================

/** 设置 search-select 组件的选中值 */
export function setSearchSelectValue(id: string, value: number): void {
    const container = document.getElementById(id) as HTMLElement | null;
    if (!container) return;
    const val = String(value);
    container.dataset.value = val;
    const tv = container.querySelector('.trigger-value');
    if (tv) tv.textContent = val;
    container.querySelectorAll<HTMLElement>('.option').forEach(o =>
        o.classList.toggle('selected', o.dataset.value === val));
}

/** 设置时值下拉 */
export function setFormDuration(d: NoteDuration): void {
    const sel = $('inputDuration') as HTMLSelectElement | null;
    if (sel) sel.value = String(d);
}

/** 更新技法按钮高亮 + 相关输入区显隐（与 tech-btn 点击逻辑一致） */
export function updateTechniqueUI(tech: AppTechnique): void {
    document.querySelectorAll('.tech-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tech-btn[data-tech="${tech}"]`);
    if (btn) btn.classList.add('active');
    uiStore.setTechnique(tech);

    const tfRow = (document.getElementById('targetFret') as HTMLElement | null)?.closest('.input-group') as HTMLElement | null;
    const bendOpts = document.getElementById('bendOptions');
    if (tech === 'bend') {
        if (tfRow) tfRow.style.display = 'none';
        if (bendOpts) bendOpts.style.display = 'flex';
    } else if (tech === 'none' || tech === 'vibrato') {
        if (tfRow) tfRow.style.display = 'none';
        if (bendOpts) bendOpts.style.display = 'none';
    } else {
        if (tfRow) tfRow.style.display = '';
        if (bendOpts) bendOpts.style.display = 'none';
    }
}

/** 设置完整技法状态（按钮 + 推弦幅度/释放 + 目标品 + 延音） */
export function setFormTechnique(tech: AppTechnique, opts: { targetFret?: number; bendAmount?: number; bendRelease?: boolean; tie?: boolean } = {}): void {
    updateTechniqueUI(tech);
    if (tech === 'bend') {
        document.querySelectorAll<HTMLElement>('.bend-amount-btn').forEach(b =>
            b.classList.toggle('active', parseFloat(b.dataset.bendAmount || '1') === opts.bendAmount));
        uiStore.bendAmount = opts.bendAmount ?? uiStore.bendAmount;
        const relBtn = document.getElementById('bendReleaseToggle');
        relBtn?.classList.toggle('active', !!opts.bendRelease);
        uiStore.bendRelease = !!opts.bendRelease;
    }
    if (opts.targetFret !== undefined) {
        const tf = document.getElementById('targetFret') as HTMLInputElement | null;
        if (tf) tf.value = String(opts.targetFret);
    }
    const tieBtn = document.querySelector('.tech-btn[data-tech="tie"]');
    tieBtn?.classList.toggle('active', !!opts.tie);
    uiStore.tieActive = !!opts.tie;
}

export function isTieActive(): boolean {
    return document.querySelector('.tech-btn[data-tech="tie"]')?.classList.contains('active') ?? false;
}

export function getTargetFret(): number | undefined {
    const input = document.getElementById('targetFret') as HTMLInputElement | null;
    if (!input) return undefined;
    const v = parseInt(input.value, 10);
    return (isNaN(v) || v < 0 || v > 24) ? undefined : v;
}

/** 从编辑表单构建 Note（不执行插入/渲染），供 addNoteBtn 与点击插入共用 */
export function buildNoteFromForm(prevFretCheck = true): { note: Note | null; error?: string } {
    const stringNum = getSearchSelectValue('stringSelect');
    const fret = getSearchSelectValue('fretSelect');
    const durSel = $('inputDuration') as HTMLSelectElement | null;
    const duration = parseFloat(durSel?.value || '0.25') as Note['duration'];
    if (stringNum < 1 || stringNum > 6) return { note: null, error: '弦号 1-6' };
    if (fret < 0 || fret > 24) return { note: null, error: '品位 0-24' };
    if (duration <= 0) return { note: null, error: '无效时值' };

    const isTie = isTieActive();
    const tech = uiStore.currentTechnique;
    const hasTech = tech !== 'none';
    const targetFret = hasTech ? getTargetFret() : undefined;

    if (prevFretCheck && !isTie && hasTech && tech !== 'bend' && tech !== 'vibrato') {
        const measure = scoreStore.getActiveMeasure();
        const prev = measure.notes[measure.notes.length - 1];
        const prevFret = prev?.targetFret || prev?.fret;
        if (targetFret === prevFret) return { note: null, error: '请选择目标品' };
    }

    // 推弦/揉弦是单音符技法，不需要 tieToNext（H/P/S 才是双音符过渡技法）
    const isSingleNoteTech = tech === 'bend' || tech === 'vibrato';
    const note: Note = {
        string: stringNum,
        fret,
        duration,
        tieToNext: isSingleNoteTech ? isTie : (isTie || hasTech),
        technique: hasTech ? tech : undefined,
        targetFret: isSingleNoteTech ? undefined : targetFret,
        bendAmount: tech === 'bend' ? uiStore.bendAmount : undefined,
        bendRelease: tech === 'bend' ? uiStore.bendRelease : undefined,
    };
    return { note };
}

// ============================================================
// 原位编辑目标（点已有音符后，表单区出现「应用修改/删除该拍」）
// ============================================================

export interface EditTarget {
    measureIndex: number;
    noteIndex: number;
    string: number;
    fret: number;
}

let editTarget: EditTarget | null = null;

/** 当前编辑目标（无则 null），供 eventHandlers 绑定按钮 */
export function getEditTarget(): EditTarget | null {
    return editTarget;
}

/** 清除编辑目标并隐藏编辑条 */
export function clearEditTarget(): void {
    editTarget = null;
    setActionBar('noteEditBar', 'noteEditHint', null);
}

/** 用表单当前值覆盖编辑目标音符（保留该拍时值；和弦内只换单弦） */
export function applyEditTarget(): void {
    const t = editTarget;
    if (!t) {
        setStatus('请先在谱面点击一个已有音符', 'info');
        return;
    }
    const built = buildNoteFromForm(false);
    if (!built.note) {
        setStatus(built.error ?? '表单值无效', 'error');
        return;
    }
    const r = scoreStore.updateNoteAt(t.measureIndex, t.noteIndex, built.note);
    if (!r.ok) {
        setStatus(r.reason ?? '修改失败', 'error');
        return;
    }
    clearEditTarget();
    setStatus(`已修改: 小节${t.measureIndex + 1} · 第${built.note.string}弦 ${built.note.fret}品`, 'success');
}

/** 把编辑目标整拍（单音/和弦）静音为休止符 */
export function muteEditTarget(): void {
    const t = editTarget;
    if (!t) {
        setStatus('请先在谱面点击一个已有音符', 'info');
        return;
    }
    const r = scoreStore.muteNoteAt(t.measureIndex, t.noteIndex);
    if (!r.ok) {
        setStatus(r.reason ?? '删除失败', 'error');
        return;
    }
    clearEditTarget();
    setStatus(`已删除（休止）: 小节${t.measureIndex + 1} · 第${t.string}弦`, 'success');
}

/**
 * 编辑/插入操作条显隐（text=null 隐藏；否则展开所在面板并滚动到可见）
 * @param barId  操作条元素 id
 * @param hintId 提示文本元素 id
 * @param text   提示文本（null = 隐藏）
 */
function setActionBar(barId: string, hintId: string, text: string | null): void {
    const bar = document.getElementById(barId) as HTMLElement | null;
    if (!bar) return;
    if (text === null) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = '';
    const hint = document.getElementById(hintId);
    if (hint) hint.textContent = text;
    const details = bar.closest('details');
    if (details instanceof HTMLDetailsElement && !details.open) details.open = true;
    bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 刷新编辑条显隐/提示 */
function renderEditUI(): void {
    setActionBar('noteEditBar', 'noteEditHint', editTarget
        ? `编辑: 小节${editTarget.measureIndex + 1} · 第${editTarget.string}弦 ${editTarget.fret}品`
        : null);
}

// ============================================================
// 点击入口
// ============================================================

export function handleScoreClick(hit: ScoreClickHit): void {
    const { beat, note } = hit;
    if (!beat) {
        // 点完全没有内容的空白处 → 取消选中，并清掉编辑/插入态
        scoreStore.selectMeasure(null);
        clearEditTarget();
        clearInsertTarget();
        setStatus('已取消选中', 'info');
        return;
    }
    const measureIndex = beat.voice.bar.index;
    // 点哪个小节就选中哪个小节（供表单追加与高亮联动）
    scoreStore.selectMeasure(measureIndex);

    if (note) {
        // 点已有音符 → 载入并进入原位编辑（不自动插入）
        clearInsertTarget();
        loadAlphaNoteIntoForm(note, beat);
        setEditTargetFromNote(note, beat, measureIndex);
        return;
    }
    // 点空白拍 → 仅定位「插入点」，确认后才写入，避免自动沿用上一个音符的数据
    clearEditTarget();
    clearInsertTarget();
    armInsertTarget(beat);
}

/** 由点中的 alphaTab 音符反查应用数据下标，记录为编辑目标 */
function setEditTargetFromNote(note: model.Note, beat: model.Beat, measureIndex: number): void {
    const appString = alphaStringToAppString(note.string);
    if (appString < 1 || appString > 6) return; // 不支持类型（载入时已报错）
    const measure = scoreStore.score.measures[measureIndex];
    if (!measure) return;
    const noteIndex = findNoteAtBeat(measure, beatOffsetInMeasure(beat), appString, note.fret);
    editTarget = noteIndex === null ? null : { measureIndex, noteIndex, string: appString, fret: note.fret };
    renderEditUI();
}

/** 点击已有音符 → 载入表单 */
function loadAlphaNoteIntoForm(note: model.Note, beat: model.Beat): void {
    const appString = alphaStringToAppString(note.string);
    if (appString < 1 || appString > 6) {
        setStatus('不支持的音符类型', 'error');
        return;
    }

    setSearchSelectValue('stringSelect', appString);
    setSearchSelectValue('fretSelect', note.fret);
    const dur = alphaDurationToAppDuration(beat.duration);
    setFormDuration(dur);

    const t = detectTechnique(note);
    setFormTechnique(t.tech, {
        targetFret: t.targetFret,
        bendAmount: t.bendAmount,
        bendRelease: t.bendRelease,
        tie: note.isTieOrigin || note.isTieDestination,
    });

    const suffix = t.tech === 'none' ? '' : ` (${t.tech})`;
    setStatus(`已载入: 第${appString}弦 ${note.fret}品 ${durationName(dur)}${suffix}`, 'info');
}

// ============================================================
// 插入点（点空白拍 → 定位，点「✓ 写入此拍」才插入）
// ============================================================

interface InsertTarget {
    measureIndex: number;
    beatOffset: number;
}

let insertTarget: InsertTarget | null = null;

/** 定位插入目标（不写谱） */
function armInsertTarget(beat: model.Beat): void {
    const measureIndex = beat.voice.bar.index;
    const measure = scoreStore.score.measures[measureIndex];
    if (!measure) {
        setStatus('小节不存在', 'error');
        return;
    }
    insertTarget = { measureIndex, beatOffset: beatOffsetInMeasure(beat) };
    renderInsertUI();
    setStatus(`已定位插入点: 小节${measureIndex + 1} · 表单设好后点「✓ 写入此拍」`, 'info');
}

/** 用表单当前值写入已定位的插入点 */
export function writeInsertTarget(): void {
    const t = insertTarget;
    if (!t) {
        setStatus('请先在谱面点击空白拍定位插入点', 'info');
        return;
    }
    const built = buildNoteFromForm(false);
    if (!built.note) {
        setStatus(built.error ?? '表单值无效', 'error');
        return;
    }
    const result = scoreStore.insertNoteAt(t.measureIndex, t.beatOffset, built.note); // 内部 _notify 自动渲染
    if (!result.ok) {
        setStatus(result.reason ?? '写入失败', 'error');
        return;
    }
    clearInsertTarget();
    setStatus(`已写入: 小节${t.measureIndex + 1} · 第${built.note.string}弦 ${built.note.fret}品`, 'success');
}

/** 取消插入点 */
export function cancelInsertTarget(): void {
    clearInsertTarget();
    setStatus('已取消插入', 'info');
}

/** 清除插入点并隐藏插入条 */
export function clearInsertTarget(): void {
    insertTarget = null;
    setActionBar('noteInsertBar', 'noteInsertHint', null);
}

/** 刷新插入条显隐/提示 */
function renderInsertUI(): void {
    setActionBar('noteInsertBar', 'noteInsertHint', insertTarget
        ? `插入点: 小节${insertTarget.measureIndex + 1}`
        : null);
}
