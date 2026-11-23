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
import type { Note, NoteDuration, NoteArticulation, AppHarmonic } from '../../core/types/index.ts';
import { NOTE_ARTICULATIONS } from '../../core/types/index.ts';
import { scoreStore } from '../../core/stores/scoreStore.ts';
import { uiStore } from '../../core/stores/uiStore.ts';
import { $, setStatus, getSearchSelectValue, getSearchSelectValues, writeSearchSelectValues, syncSearchSelectLimit } from '../../app/dom.ts';
import { alphaStringToAppString, alphaDurationToAppDuration, beatOffsetInMeasure, detectTechnique, detectArticulations, normalizeHarmonicFret, type DetectedArticulations } from '../../core/utils/scoreMapping.ts';
import type { AppTechnique } from '../../core/types/index.ts';
import { durationName } from '../../core/utils/duration.ts';
import { beatIndexToOffset } from '../../core/utils/measureUtils.ts';
import { findNoteAtBeat } from '../../core/utils/measureEdit.ts';
import { buildNoteGroup, nextChordGroupId, type NoteGroupBase } from '../../core/utils/noteGroup.ts';
import { followTargetFret, isConnectingTechnique, resolveSoundingFret } from '../../core/utils/technique.ts';
import { t, type MessageKey } from '../../core/i18n/index.ts';

export type { AppTechnique } from '../../core/types/index.ts';

export interface ScoreClickHit {
    beat: model.Beat | null;
    note: model.Note | null;
    /** 渲染器给出的六线谱单元（五线谱区域/几何不可用时为 null） */
    cell?: TabCellHit | null;
}

/**
 * 六线谱单元命中结果（渲染器 → scoreEditing 的结构契约）。
 *
 * `beatIndex` 为 alphaTab beat 下标（与应用 slot 顺序一致）；null = 小节尾。
 * `alphaString` 为 alphaTab 弦号（1 = 最底弦）。
 */
export interface TabCellHit {
    measureIndex: number;
    beatIndex: number | null;
    alphaString: number;
    note: model.Note | null;
    /** 该拍位的模型 beat（小节尾为 null）；全局 beat 命中失败时用它补时值 */
    beat?: model.Beat | null;
}

// ============================================================
// 表单辅助（eventHandlers 复用）
// ============================================================

/** 设置 search-select 组件的选中值（多选组件会清除其余选项） */
export function setSearchSelectValues(id: string, values: number[]): void {
    const container = document.getElementById(id);
    if (container) writeSearchSelectValues(container, values);
}

export function setSearchSelectValue(id: string, value: number): void {
    setSearchSelectValues(id, [value]);
}

/**
 * 约束弦号选择数量：H/P/S 是双音过渡技法，一次只能落在一根弦上（limit=1）；
 * 其他技法/普通音符传 null 解除限制。超限时按弦号保留前 N 根。
 */
function setStringSelectionLimit(limit: number | null): void {
    const container = document.getElementById('stringSelect');
    if (!container) return;
    if (limit === null) delete container.dataset.maxSelected;
    else container.dataset.maxSelected = String(limit);

    const selected = getSearchSelectValues('stringSelect');
    if (limit !== null && selected.length > limit) {
        setSearchSelectValues('stringSelect', selected.slice(0, limit));
    } else {
        syncSearchSelectLimit(container);
    }
}

/** 设置时值下拉 */
export function setFormDuration(d: NoteDuration): void {
    const sel = $('inputDuration') as HTMLSelectElement | null;
    if (sel) sel.value = String(d);
}

/** 更新技法按钮高亮 + 相关输入区显隐（与 tech-btn 点击逻辑一致） */
export function updateTechniqueUI(tech: AppTechnique): void {
    // 进入 H/P/S 时目标品默认跟当前品一致：目标品记的是到达音，
    // 不该沿用上一次输入/初始 0，把正在编辑的音符写到别的品上。
    const wasConnecting = isConnectingTechnique(uiStore.currentTechnique);

    document.querySelectorAll('.tech-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tech-btn[data-tech="${tech}"]`);
    if (btn) btn.classList.add('active');
    uiStore.setTechnique(tech);

    // H/P/S 只能作用在一根弦上：切换技法时同步限制弦号多选
    setStringSelectionLimit(isConnectingTechnique(tech) ? 1 : null);

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
        if (!wasConnecting) {
            const tf = document.getElementById('targetFret') as HTMLInputElement | null;
            if (tf) tf.value = String(getSearchSelectValue('fretSelect'));
        }
    }
}

/**
 * 「品」改变时让「目标品」跟随（H/P/S 且目标品未被显式改过时）。
 *
 * capture 阶段先取旧品，微任务里等单选处理器写回新品后再算；
 * 只响应用户点击——程序化回填（loadAlphaNoteIntoForm）不触发 click。
 */
export function initTargetFretFollow(): void {
    const list = document.querySelector('#fretSelect .options-list');
    if (!list) return;
    list.addEventListener('click', () => {
        const prevFret = getSearchSelectValue('fretSelect');
        queueMicrotask(() => {
            const tf = document.getElementById('targetFret') as HTMLInputElement | null;
            if (!tf) return;
            const target = parseInt(tf.value, 10);
            if (isNaN(target)) return;
            const next = followTargetFret(
                getSearchSelectValue('fretSelect'), prevFret, target, uiStore.currentTechnique,
            );
            if (next !== target) tf.value = String(next);
        });
    }, { capture: true });
}

/** 设置完整技法状态（按钮 + 推弦幅度/释放 + 目标品 + 延音） */
export function setFormTechnique(tech: AppTechnique, opts: { targetFret?: number; bendAmount?: number; bendRelease?: boolean; tie?: boolean } = {}): void {
    updateTechniqueUI(tech);
    if (tech === 'bend') {
        document.querySelectorAll<HTMLElement>('.bend-amount-btn').forEach(b =>
            b.classList.toggle('active', parseFloat(b.dataset.bendAmount || '1') === opts.bendAmount));
        uiStore.setBendAmount(opts.bendAmount ?? uiStore.bendAmount);
        const relBtn = document.getElementById('bendReleaseToggle');
        relBtn?.classList.toggle('active', !!opts.bendRelease);
        uiStore.setBendRelease(!!opts.bendRelease);
    }
    if (opts.targetFret !== undefined) {
        const tf = document.getElementById('targetFret') as HTMLInputElement | null;
        if (tf) tf.value = String(opts.targetFret);
    }
    const tieBtn = document.querySelector('.tech-btn[data-tech="tie"]');
    tieBtn?.classList.toggle('active', !!opts.tie);
    uiStore.setTie(!!opts.tie);
}

/** 奏法/泛音显示名的文案 key（noteInput 复用，避免两处各写一份） */
const ARTICULATION_LABEL_KEYS: Record<NoteArticulation, MessageKey> = {
    palmMute: 'articulation.palmMute',
    deadNote: 'articulation.deadNote',
    letRing: 'articulation.letRing',
    staccato: 'articulation.staccato',
};

const HARMONIC_LABEL_KEYS: Record<AppHarmonic, MessageKey> = {
    natural: 'harmonic.natural',
    artificial: 'harmonic.artificial',
    pinch: 'harmonic.pinch',
};

/** 奏法显示名（按当前界面语言；不要在模块级缓存结果） */
export function articulationLabel(name: NoteArticulation): string {
    return t(ARTICULATION_LABEL_KEYS[name]);
}

export function harmonicLabel(name: AppHarmonic): string {
    return t(HARMONIC_LABEL_KEYS[name]);
}

/** 音符状态栏的奏法简写：PM / X / LR / ST / 泛音:人工泛音@12品 */
export function formatArticulationSuffix(a: {
    palmMute?: boolean;
    deadNote?: boolean;
    letRing?: boolean;
    staccato?: boolean;
    harmonic?: AppHarmonic;
    harmonicFret?: number;
}): string {
    return [
        a.palmMute ? 'PM' : '',
        a.deadNote ? 'X' : '',
        a.letRing ? 'LR' : '',
        a.staccato ? 'ST' : '',
        a.harmonic
            ? t('scoreEdit.harmonicSuffix', {
                name: harmonicLabel(a.harmonic)
                    + (a.harmonic !== 'natural' && a.harmonicFret
                        ? t('scoreEdit.harmonicFretTag', { fret: a.harmonicFret })
                        : ''),
            })
            : '',
    ].filter(Boolean).join(' ');
}

/** 人工/捏弦泛音需要触弦点，自然泛音不需要；按当前选择显隐输入框 */
export function updateHarmonicUI(): void {
    const fretInput = $('harmonicFret') as HTMLInputElement | null;
    if (!fretInput) return;
    const needsFret = uiStore.currentHarmonic === 'artificial' || uiStore.currentHarmonic === 'pinch';
    fretInput.style.display = needsFret ? '' : 'none';
}

/** 设置完整奏法/泛音状态（按钮 + 下拉 + 触弦点） */
export function setFormArticulations(a: DetectedArticulations): void {
    // 制音与泛音互斥（制音优先）：与 getArticulationFields / sanitizeNote 同一条规则，
    // 否则谱面里两者兼有的音符会在表单里「都选上」，落库时却被静默丢掉泛音。
    const harmonic = a.deadNote ? undefined : a.harmonic;

    for (const name of NOTE_ARTICULATIONS) {
        const active = a[name];
        document.querySelector(`.artic-btn[data-artic="${name}"]`)?.classList.toggle('active', active);
        uiStore.setArticulation(name, active);
    }

    uiStore.setHarmonic(harmonic ?? '');
    const sel = $('harmonicSelect') as HTMLSelectElement | null;
    if (sel) sel.value = harmonic ?? '';
    if (a.harmonicFret !== undefined) {
        uiStore.setHarmonicFret(a.harmonicFret);
    }
    const fretInput = $('harmonicFret') as HTMLInputElement | null;
    if (fretInput) fretInput.value = String(uiStore.harmonicFret);
    updateHarmonicUI();
}

/** 当前表单奏法 → Note 的可选字段（供单音与和弦录入共用） */
export function getArticulationFields(): Pick<Note, 'palmMute' | 'deadNote' | 'letRing' | 'staccato' | 'harmonic' | 'harmonicFret'> {
    const a = uiStore.currentArticulations;
    // 制音与泛音互斥：制音是压住琴弦的打击音，泛音要求节点处自由振动
    const harmonic = a.deadNote ? undefined : (uiStore.currentHarmonic || undefined);
    return {
        palmMute: a.palmMute || undefined,
        deadNote: a.deadNote || undefined,
        letRing: a.letRing || undefined,
        staccato: a.staccato || undefined,
        harmonic,
        // 表外触弦点（如 6 品）先规范化：alphaTab 会按 12 品发声，存值必须与之一致
        harmonicFret: harmonic && harmonic !== 'natural' ? normalizeHarmonicFret(uiStore.harmonicFret) : undefined,
    };
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

/** 从编辑表单构建同一拍位的 Note 数组（不执行插入/渲染），供添加与点击插入共用 */
export function buildNotesFromForm(prevFretCheck = true): { notes: Note[]; error?: string } {
    const strings = getSearchSelectValues('stringSelect');
    const fret = getSearchSelectValue('fretSelect');
    const durSel = $('inputDuration') as HTMLSelectElement | null;
    const duration = parseFloat(durSel?.value || '0.25') as Note['duration'];
    if (strings.length === 0) return { notes: [], error: t('scoreEdit.needString') };
    if (strings.some(s => s < 1 || s > 6)) return { notes: [], error: t('scoreEdit.stringRange') };
    if (fret < 0 || fret > 24) return { notes: [], error: t('scoreEdit.fretRange') };
    if (duration <= 0) return { notes: [], error: t('note.status.invalidDuration') };

    const isTie = isTieActive();
    const tech = uiStore.currentTechnique;
    const hasTech = tech !== 'none';
    const targetFret = hasTech ? getTargetFret() : undefined;

    // 防御：H/P/S 是双音过渡技法，一对弦只能有一个目标弦
    if (isConnectingTechnique(tech) && strings.length > 1) {
        return { notes: [], error: t('scoreEdit.singleStringTech') };
    }
    // 到达品是连接类技法唯一的音高来源，缺失时不能回退成「无位移连接」
    if (isConnectingTechnique(tech) && targetFret === undefined) {
        return { notes: [], error: t('scoreEdit.needTargetFretRange') };
    }

    if (prevFretCheck && !isTie && isConnectingTechnique(tech)) {
        const measure = scoreStore.getActiveMeasure();
        const prev = measure.notes[measure.notes.length - 1];
        const prevFret = prev?.targetFret || prev?.fret;
        if (targetFret === prevFret) return { notes: [], error: t('scoreEdit.needTargetFret') };
    }

    // 推弦/揉弦是单音符技法，不需要 tieToNext（H/P/S 才是双音符过渡技法）
    const isSingleNoteTech = tech === 'bend' || tech === 'vibrato';
    const base: NoteGroupBase = {
        duration,
        tieToNext: isSingleNoteTech ? isTie : (isTie || hasTech),
        technique: hasTech ? tech : undefined,
        targetFret: isSingleNoteTech ? undefined : targetFret,
        bendAmount: tech === 'bend' ? uiStore.bendAmount : undefined,
        bendRelease: tech === 'bend' ? uiStore.bendRelease : undefined,
        ...getArticulationFields(),
    };

    // H/P/S：表单的「品」是起点、「目标品」是到达点，而谱面/播放只读 Note.fret，
    // 所以写入的音符必须落在到达品上。若仍写起点，弧线会连到下一拍音符的品
    // （先击后勾看起来全是击弦），目标品也永远不会被渲染。
    const soundingFret = resolveSoundingFret(fret, tech, targetFret);
    const members = strings.map(s => ({ string: s, fret: soundingFret }));
    const chordGroup = members.length > 1
        ? nextChordGroupId(scoreStore.score.measures)
        : undefined;
    return { notes: buildNoteGroup(members, base, {}, chordGroup) };
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
    const target = editTarget;
    if (!target) {
        setStatus(t('scoreEdit.selectFirst'), 'info');
        return;
    }
    const built = buildNotesFromForm(false);
    if (built.notes.length === 0) {
        setStatus(built.error ?? t('note.status.invalidForm'), 'error');
        return;
    }
    // 原位编辑只改被点中的那根弦：多选时取目标弦，未包含则沿用表单值强制落到目标弦
    const note = built.notes.find(n => n.string === target.string)
        ?? { ...built.notes[0], string: target.string };
    const r = scoreStore.updateNoteAt(target.measureIndex, target.noteIndex, note);
    if (!r.ok) {
        setStatus(r.reason ?? t('scoreEdit.updateFailed'), 'error');
        return;
    }
    clearEditTarget();
    scoreStore.setEditCursor(null);
    setStatus(t('scoreEdit.updated', {
        measure: target.measureIndex + 1,
        string: note.string ?? target.string,
        fret: note.fret ?? 0,
    }), 'success');
}

/** 把编辑目标整拍（单音/和弦）静音为休止符 */
export function muteEditTarget(): void {
    const target = editTarget;
    if (!target) {
        setStatus(t('scoreEdit.selectFirst'), 'info');
        return;
    }
    const r = scoreStore.muteNoteAt(target.measureIndex, target.noteIndex);
    if (!r.ok) {
        setStatus(r.reason ?? t('scoreEdit.deleteFailed'), 'error');
        return;
    }
    clearEditTarget();
    scoreStore.setEditCursor(null);
    setStatus(t('scoreEdit.muted', {
        measure: target.measureIndex + 1,
        string: target.string,
    }), 'success');
}

/**
 * 编辑/插入操作条显隐（text=null 隐藏；否则展开所在面板）
 * @param barId  操作条元素 id
 * @param hintId 提示文本元素 id
 * @param text   提示文本（null = 隐藏）
 * @param opts.scroll 是否滚动到可见（语言切换刷新时传 false）
 * @param opts.expand 是否展开所在折叠面板（语言切换刷新时传 false，尊重用户收起状态）
 */
function setActionBar(
    barId: string,
    hintId: string,
    text: string | null,
    opts: { scroll?: boolean; expand?: boolean } = {},
): void {
    const { scroll = true, expand = true } = opts;
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
    if (expand && details instanceof HTMLDetailsElement && !details.open) details.open = true;
    if (scroll) bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 刷新编辑条显隐/提示 */
function renderEditUI(opts: { scroll?: boolean; expand?: boolean } = {}): void {
    setActionBar('noteEditBar', 'noteEditHint', editTarget
        ? t('scoreEdit.editHint', {
            measure: editTarget.measureIndex + 1,
            string: editTarget.string,
            fret: editTarget.fret,
        })
        : null, opts);
}

/** 语言切换就地刷新编辑/插入条文案：不改选择、不滚动、不展开折叠面板、不重绑事件 */
export function refreshEditUiText(): void {
    renderEditUI({ scroll: false, expand: false });
    renderInsertUI({ scroll: false, expand: false });
}

// ============================================================
// 点击入口
// ============================================================

/**
 * 渲染器命中的六线谱单元 → scoreStore.editCursor。
 *
 * 拍偏移取该 slot 的起点；小节尾用 measureTotalBeats。弦号优先取点中音符的
 * alphaTab 弦号（修正行反查的取整误差），否则用几何反查结果。
 *
 * @returns 是否成功设置光标。下标失配（`beatIndexToOffset` 返回 null）或弦号
 *          不在 1..6 时返回 false，调用方继续走旧的选中/命中路径。
 */
function applyCellCursor(cell: TabCellHit): boolean {
    const measure = scoreStore.score.measures[cell.measureIndex];
    if (!measure) return false;
    const beatOffset = beatIndexToOffset(measure, cell.beatIndex);
    if (beatOffset === null) return false; // 下标与 slot 失配：不猜落点，交给旧路径
    const alphaString = cell.note?.string ?? cell.alphaString;
    const string = alphaStringToAppString(alphaString);
    if (string < 1 || string > 6) return false;
    scoreStore.setEditCursor({ measureIndex: cell.measureIndex, beatOffset, string });
    return true;
}

/**
 * 空白单元定位成功后，把表单同步为该单元：弦号设为光标弦（单弦语义），
 * 品归零（空弦）。空白单元没有音符，品没有可同步的来源；归零避免沿用
 * 上一个音符的品，导致下一次写入误带旧值。targetFret 是 H/P/S 的目标品，
 * 由技法逻辑维护，此处不动。
 */
function syncFormFromCursor(): void {
    const cursor = scoreStore.editCursor;
    if (!cursor) return;
    setSearchSelectValue('stringSelect', cursor.string);
    setSearchSelectValue('fretSelect', 0);
}

export function handleScoreClick(hit: ScoreClickHit): void {
    const cell = hit.cell ?? null;
    // alphaTab 的全局 beat/note 命中依赖光标坐标，音符头很小时会落空。
    // 单元命中已按几何行反查到模型音符：以它为兜底，保证点到已有音符时
    // 弦、品与表单完全同步，而不是误判成空白单元把品归零。
    const beat = hit.beat ?? cell?.beat ?? null;
    const note = hit.note ?? cell?.note ?? null;
    // 只读光标是附加能力：先定位，再走原有音符/插入分支。
    // setEditCursor 会同步 selectedMeasure，后续不要在 cell 路径再 selectMeasure：
    // 既会重复通知，也可能因小节号不一致把刚设的光标清掉。
    const cursorApplied = cell ? applyCellCursor(cell) : false;

    if (!beat) {
        if (cell) {
            // 点到小节尾等无 beat 的空白：光标已由 applyCellCursor 尝试定位
            // （下标失配时不设，保留原状态），这里只收起编辑/插入态。
            if (cursorApplied) syncFormFromCursor();
            clearEditTarget();
            clearInsertTarget();
            return;
        }
        // 点完全没有内容的空白处 → 取消选中；selectMeasure(null) 同时清掉光标
        scoreStore.selectMeasure(null);
        clearEditTarget();
        clearInsertTarget();
        setStatus(t('scoreEdit.selectionCleared'), 'info');
        return;
    }
    const measureIndex = beat.voice.bar.index;
    // 没有成功定位光标时才用选中动作兜底（点哪个小节就选中哪个小节）
    if (!cursorApplied) scoreStore.selectMeasure(measureIndex);

    if (note) {
        // 点已有音符 → 载入并进入原位编辑（不自动插入）
        clearInsertTarget();
        loadAlphaNoteIntoForm(note, beat);
        setEditTargetFromNote(note, beat, measureIndex);
        return;
    }
    // 点空白拍 → 仅定位「插入点」，确认后才写入，避免自动沿用上一个音符的数据。
    // 落点优先取六线谱单元的下标（小节尾 = measureTotalBeats），保证与光标一致；
    // 没有 cell 时才回落到旧 beat 的拍偏移。
    const measure = scoreStore.score.measures[measureIndex];
    const cellOffset = cell && measure ? beatIndexToOffset(measure, cell.beatIndex) : null;
    // 弦跟随光标所在弦；空白单元没有音符，品归零（空弦）。
    if (cursorApplied) syncFormFromCursor();
    clearEditTarget();
    clearInsertTarget();
    armInsertTarget(measureIndex, cellOffset ?? beatOffsetInMeasure(beat));
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
        setStatus(t('scoreEdit.unsupportedNote'), 'error');
        return;
    }

    setSearchSelectValue('stringSelect', appString);
    setSearchSelectValue('fretSelect', note.fret);
    const dur = alphaDurationToAppDuration(beat.duration);
    setFormDuration(dur);

    const technique = detectTechnique(note, uiStore.bendAmount);
    setFormTechnique(technique.tech, {
        targetFret: technique.targetFret,
        bendAmount: technique.bendAmount,
        bendRelease: technique.bendRelease,
        tie: note.isTieOrigin || note.isTieDestination,
    });

    const arts = detectArticulations(note);
    setFormArticulations(arts);

    const suffix = [technique.tech === 'none' ? '' : technique.tech, formatArticulationSuffix(arts)].filter(Boolean).join(' ');
    setStatus(t('scoreEdit.loaded', {
        string: appString,
        fret: note.fret,
        duration: durationName(dur),
        suffix: suffix ? ` (${suffix})` : '',
    }), 'info');
}

// ============================================================
// 插入点（点空白拍 → 定位，点「✓ 写入此拍」才插入）
// ============================================================

interface InsertTarget {
    measureIndex: number;
    beatOffset: number;
}

let insertTarget: InsertTarget | null = null;

/**
 * 定位插入目标（不写谱）。
 *
 * `beatOffset` 由调用方给出（cell 下标换算或 beat 拍偏移），小节尾传
 * `measureTotalBeats`；`insertNotesAt` 对本节尾/已满小节只会安全地拒绝写入。
 */
function armInsertTarget(measureIndex: number, beatOffset: number): void {
    const measure = scoreStore.score.measures[measureIndex];
    if (!measure) {
        setStatus(t('scoreEdit.measureMissing'), 'error');
        return;
    }
    insertTarget = { measureIndex, beatOffset };
    renderInsertUI();
    setStatus(t('scoreEdit.insertArmed', { measure: measureIndex + 1 }), 'info');
}

/** 用表单当前值写入已定位的插入点 */
export function writeInsertTarget(): void {
    const target = insertTarget;
    if (!target) {
        setStatus(t('scoreEdit.insertFirst'), 'info');
        return;
    }
    const built = buildNotesFromForm(false);
    if (built.notes.length === 0) {
        setStatus(built.error ?? t('note.status.invalidForm'), 'error');
        return;
    }
    const result = scoreStore.insertNotesAt(target.measureIndex, target.beatOffset, built.notes); // 内部 _notify 自动渲染
    if (!result.ok) {
        setStatus(result.reason ?? t('scoreEdit.writeFailed'), 'error');
        return;
    }
    clearInsertTarget();
    scoreStore.setEditCursor(null);
    const stringList = built.notes.map(n => n.string ?? 1).join(',');
    setStatus(t('scoreEdit.written', {
        measure: target.measureIndex + 1,
        strings: stringList,
        fret: built.notes[0].fret ?? 0,
    }), 'success');
}

/** 取消插入点 */
export function cancelInsertTarget(): void {
    clearInsertTarget();
    setStatus(t('scoreEdit.insertCanceled'), 'info');
}

/** 清除插入点并隐藏插入条 */
export function clearInsertTarget(): void {
    insertTarget = null;
    setActionBar('noteInsertBar', 'noteInsertHint', null);
}

/** 刷新插入条显隐/提示 */
function renderInsertUI(opts: { scroll?: boolean; expand?: boolean } = {}): void {
    setActionBar('noteInsertBar', 'noteInsertHint', insertTarget
        ? t('scoreEdit.insertHint', { measure: insertTarget.measureIndex + 1 })
        : null, opts);
}
