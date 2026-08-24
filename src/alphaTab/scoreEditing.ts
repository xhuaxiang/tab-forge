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
import type { Note, NoteDuration } from '../types/index.ts';
import { scoreStore } from '../stores/scoreStore.ts';
import { uiStore } from '../stores/uiStore.ts';
import { $, setStatus, getSearchSelectValue, durationName } from '../state.ts';
import { alphaStringToAppString, alphaDurationToAppDuration, beatOffsetInMeasure, detectTechnique, type AppTechnique } from './scoreMapping.ts';

export type { AppTechnique } from './scoreMapping.ts';

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
// 点击入口
// ============================================================

export function handleScoreClick(hit: ScoreClickHit): void {
    const { beat, note } = hit;
    if (!beat) {
        setStatus('未命中拍位（点击空白）', 'info');
        return;
    }
    if (note) {
        loadAlphaNoteIntoForm(note, beat);
        return;
    }
    insertNoteAtBeat(beat);
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

/** 点击空白拍 → 用表单值插入音符 */
function insertNoteAtBeat(beat: model.Beat): void {
    const measureIndex = beat.voice.bar.index;
    const measure = scoreStore.score.measures[measureIndex];
    if (!measure) {
        setStatus('小节不存在', 'error');
        return;
    }

    const built = buildNoteFromForm(false);
    if (!built.note) {
        setStatus(built.error ?? '表单值无效', 'error');
        return;
    }

    const offset = beatOffsetInMeasure(beat);
    const result = scoreStore.insertNoteAt(measureIndex, offset, built.note); // 内部 _notify 自动渲染
    if (!result.ok) {
        setStatus(result.reason ?? '插入失败', 'error');
        return;
    }

    setStatus(`已插入: 第${built.note.string}弦 ${built.note.fret}品 ${durationName(built.note.duration)} @ 小节${measureIndex + 1}`, 'success');
}
