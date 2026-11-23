/**
 * noteInput — 音符/和弦录入相关事件绑定
 */

import type { Note, AppHarmonic, NoteArticulation } from '../../core/types/index.ts';
import { NOTE_ARTICULATIONS } from '../../core/types/index.ts';
import { $, setStatus } from '../dom.ts';
import { canAddToMeasure } from '../../core/utils/measureUtils.ts';
import { durationName } from '../../core/utils/duration.ts';
import { buildNoteGroup, nextChordGroupId, type NoteGroupMember } from '../../core/utils/noteGroup.ts';
import { scoreStore } from '../../core/stores/scoreStore.ts';
import { uiStore } from '../../core/stores/uiStore.ts';
import { CHORD_PRESETS, updateStrumButton, updateArpeggioButton } from './chordInput.ts';
import { BEND_AMOUNT_LABELS, HARMONIC_FRET_MIN, HARMONIC_FRET_MAX } from '../../core/config.ts';
import { t, type MessageKey } from '../../core/i18n/index.ts';
import { buildNotesFromForm, updateTechniqueUI, initTargetFretFollow, isTieActive, applyEditTarget, muteEditTarget, clearEditTarget, writeInsertTarget, cancelInsertTarget, clearInsertTarget, getArticulationFields, updateHarmonicUI, formatArticulationSuffix, articulationLabel, harmonicLabel, type AppTechnique } from '../../features/alphaTab/scoreEditing.ts';

/** 技法简写（状态栏后缀）文案 key；'none' 不产生后缀 */
const TECH_SUFFIX_KEYS: Record<Exclude<AppTechnique, 'none'>, MessageKey> = {
    hammerOn: 'note.tech.hammerOn',
    pullOff: 'note.tech.pullOff',
    slide: 'note.tech.slide',
    bend: 'note.tech.bend',
    vibrato: 'note.tech.vibrato',
};

function techSuffixLabel(tech: AppTechnique): string {
    return tech === 'none' ? tech : t(TECH_SUFFIX_KEYS[tech]);
}

export function initNoteInput(): void {
    // ============================================================
    // 技法栏事件
    // ============================================================

    document.querySelectorAll<HTMLElement>('.tech-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tech = btn.dataset.tech as string;
            if (tech === 'tie') {
                // 延音标记独立切换，不改技法
                btn.classList.toggle('active');
                uiStore.setTie(btn.classList.contains('active'));
                return;
            }
            updateTechniqueUI(tech as AppTechnique);
        });
    });

    // 品变化时 H/P/S 的目标品默认跟随（用户显式改过目标品后不再覆盖）
    initTargetFretFollow();

    // ============================================================
    // 奏法开关 / 泛音（与技法栏正交，可同时生效）
    // ============================================================

    document.querySelectorAll<HTMLElement>('.artic-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.artic as NoteArticulation | undefined;
            if (!name || !(NOTE_ARTICULATIONS as readonly string[]).includes(name)) return;
            const active = !btn.classList.contains('active');
            btn.classList.toggle('active', active);
            uiStore.setArticulation(name, active);

            // 制音与泛音互斥：开启制音时关掉泛音
            if (name === 'deadNote' && active) {
                uiStore.setHarmonic('');
                const sel = $('harmonicSelect') as HTMLSelectElement | null;
                if (sel) sel.value = '';
                updateHarmonicUI();
            }
            setStatus(t('note.status.articulation', {
                name: articulationLabel(name),
                state: t(active ? 'common.on' : 'common.off'),
            }), 'info');
        });
    });

    const harmonicSel = $('harmonicSelect') as HTMLSelectElement | null;
    harmonicSel?.addEventListener('change', () => {
        const harmonic = harmonicSel.value as '' | AppHarmonic;
        uiStore.setHarmonic(harmonic);

        // 泛音与制音互斥：选泛音时关掉制音
        if (harmonic) {
            const deadBtn = document.querySelector<HTMLElement>('.artic-btn[data-artic="deadNote"]');
            deadBtn?.classList.remove('active');
            uiStore.setArticulation('deadNote', false);
        }
        updateHarmonicUI();
        setStatus(harmonic
            ? t('note.status.harmonic', { name: harmonicLabel(harmonic) })
            : t('note.status.harmonicOff'), 'info');
    });

    const harmonicFretInput = $('harmonicFret') as HTMLInputElement | null;
    harmonicFretInput?.addEventListener('input', () => {
        const fret = parseInt(harmonicFretInput.value, 10);
        if (!isNaN(fret) && fret >= HARMONIC_FRET_MIN && fret <= HARMONIC_FRET_MAX) {
            uiStore.setHarmonicFret(fret);
        } else {
            // 清空/非法输入：回写成 store 的值，避免界面空着而数据还留着旧值
            harmonicFretInput.value = String(uiStore.harmonicFret);
        }
    });
    // 默认值由 store（config）提供，index.html 不硬编码，避免两处漂移
    if (harmonicFretInput) harmonicFretInput.value = String(uiStore.harmonicFret);
    updateHarmonicUI();

    // --- 添加音符（新增/追加时退出原位编辑态） ---
    $('addNoteBtn')?.addEventListener('click', () => {
        clearEditTarget();
        clearInsertTarget();
        const measure = scoreStore.getActiveMeasure();
        const durSel = $('inputDuration') as HTMLSelectElement | null;
        const duration = parseFloat(durSel?.value || '0.25') as Note['duration'];
        if (!canAddToMeasure(measure, duration)) {
            setStatus(t('note.status.beatFullWithTime', {
                numerator: measure.timeSignatureNumerator,
                denominator: measure.timeSignatureDenominator,
            }), 'error');
            return;
        }
        const built = buildNotesFromForm(true);
        if (built.notes.length === 0) {
            setStatus(built.error ?? t('note.status.invalidForm'), 'error');
            return;
        }
        const notes = built.notes;
        const first = notes[0];
        const stringList = notes.map(n => n.string ?? 1).join(',');
        const fret = first.fret ?? 0;
        const isTie = isTieActive();
        const tech = first.technique;
        const hasTech = tech !== undefined;

        // 多弦整组一次写入，只触发一次渲染
        const added = scoreStore.addNotes(notes);
        if (!added.ok) {
            setStatus(added.reason ?? t('note.status.addFailed'), 'error');
            return;
        }

        let suffix = '';
        if (isTie) suffix = t('note.suffix.tie');
        if (hasTech) {
            suffix += t('note.suffix.tech', { name: techSuffixLabel(tech) });
            if (tech === 'bend') {
                suffix += t('note.suffix.bendAmount', { amount: BEND_AMOUNT_LABELS[uiStore.bendAmount] || uiStore.bendAmount });
                if (uiStore.bendRelease) suffix += t('note.suffix.release');
            } else if (first.targetFret !== undefined) {
                suffix += t('note.suffix.targetFret', { fret: first.targetFret });
            }
        }

        const artLabels = formatArticulationSuffix(first);
        if (artLabels) suffix += ` (${artLabels})`;

        setStatus(t('note.status.added', {
            measure: scoreStore.activeMeasureIndex() + 1,
            strings: stringList,
            fret,
            duration: durationName(first.duration),
            suffix,
        }), 'success');
    });

    // --- 休止符 ---
    $('addRestBtn')?.addEventListener('click', () => {
        clearEditTarget();
        clearInsertTarget();
        const durSel = $('inputDuration') as HTMLSelectElement;
        const duration = parseFloat(durSel?.value || '0.25');
        if (duration <= 0) { setStatus(t('note.status.invalidDuration'), 'error'); return; }
        const measure = scoreStore.getActiveMeasure();
        if (!canAddToMeasure(measure, duration)) {
            setStatus(t('note.status.beatFull'), 'error');
            return;
        }
        scoreStore.addRest(duration);
        setStatus(t('note.status.restAdded', {
            measure: scoreStore.activeMeasureIndex() + 1,
            duration: durationName(duration),
        }), 'success');
    });

    // --- 原位编辑已有音符（点谱面音符后出现） ---
    $('applyNoteEditBtn')?.addEventListener('click', applyEditTarget);
    $('muteNoteBtn')?.addEventListener('click', muteEditTarget);
    $('cancelNoteEditBtn')?.addEventListener('click', clearEditTarget);

    // --- 定位插入点（点空白拍后出现） ---
    $('writeInsertBtn')?.addEventListener('click', writeInsertTarget);
    $('cancelInsertBtn')?.addEventListener('click', cancelInsertTarget);

    // --- 推弦幅度按钮 ---
    document.querySelectorAll('.bend-amount-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.bend-amount-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const amount = parseFloat((btn as HTMLElement).dataset.bendAmount || '1');
            uiStore.setBendAmount(amount);
        });
    });

    // --- 推弦释放切换 ---
    $('bendReleaseToggle')?.addEventListener('click', () => {
        const btn = $('bendReleaseToggle')!;
        uiStore.setBendRelease(!uiStore.bendRelease);
        btn.classList.toggle('active', uiStore.bendRelease);
    });

    // --- 琶音切换 ---
    const arpBtn = $('arpeggioToggle');
    arpBtn?.addEventListener('click', () => {
        uiStore.cycleArpeggio();
        updateArpeggioButton();
        if (uiStore.currentArpeggio === 'up') {
            setStatus(t('note.status.arpeggioUp'), 'info');
        } else if (uiStore.currentArpeggio === 'down') {
            setStatus(t('note.status.arpeggioDown'), 'info');
        } else {
            setStatus(t('note.status.arpeggioOff'), 'info');
        }
    });

    // --- 扫弦切换 ---
    const strumBtn = $('strumToggle');
    strumBtn?.addEventListener('click', () => {
        uiStore.toggleStrum();
        updateStrumButton();
        if (uiStore.currentStrum === 'down') {
            setStatus(t('note.status.strumDown'), 'info');
        } else if (uiStore.currentStrum === 'up') {
            setStatus(t('note.status.strumUp'), 'info');
        } else {
            setStatus(t('note.status.strumOff'), 'info');
        }
    });

    // 预设按钮
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const str = btn.getAttribute('data-chord');
            if (!str) return;
            const frets = str.split(',').map(Number);
            if (frets.length !== 6) return;

            uiStore.setChordFrets(frets);
            const cc = document.getElementById('chordGridCells') as HTMLElement
            // 更新网格高亮
            cc.querySelectorAll('.chord-grid-cell.selected').forEach(c => c.classList.remove('selected'));
            for (let s = 0; s < 6; s++) {
                const f = frets[s];
                if (f >= 0 && f <= 5) {
                    const cell = cc.querySelector(`.chord-grid-cell[data-string="${s + 1}"][data-fret="${f}"]`);
                    if (cell) cell.classList.add('selected');
                }
            }
        });
    });

    // --- 添加和弦 ---
    $('addChordBtn')?.addEventListener('click', () => {
        clearEditTarget();
        clearInsertTarget();
        const durSel = document.getElementById('chordDuration') as HTMLSelectElement;
        const duration = parseFloat(durSel?.value || '0.25') as Note['duration'];
        if (duration <= 0) { setStatus(t('note.status.invalidDuration'), 'error'); return; }

        const active: NoteGroupMember[] = [];
        for (let s = 0; s < 6; s++) {
            if (uiStore.currentChordFrets[s] >= 0 && uiStore.currentChordFrets[s] <= 5) {
                active.push({ string: s + 1, fret: uiStore.currentChordFrets[s] });
            }
        }
        if (active.length === 0) { setStatus(t('note.status.needChordString'), 'error'); return; }

        const measure = scoreStore.getActiveMeasure();
        if (!canAddToMeasure(measure, duration)) {
            setStatus(t('note.status.beatFull'), 'error');
            return;
        }

        // 匹配预设和弦名称
        const matched = CHORD_PRESETS.find(p => p.frets.every((f, i) => f === uiStore.currentChordFrets[i]));
        const chordName = matched ? matched.name : '';
        const hadArpeggio = !!uiStore.currentArpeggio;

        // 单弦不写 chordGroup；多弦整组共享一个 id
        const chordGroup = active.length > 1
            ? nextChordGroupId(scoreStore.score.measures)
            : undefined;
        const notes = buildNoteGroup(
            active,
            { duration, ...getArticulationFields() }, // 奏法对整个和弦生效（闷音扫弦、泛音和弦等）
            {
                chordName: chordName || undefined,
                arpeggio: uiStore.currentArpeggio || undefined,
                strum: uiStore.currentStrum || undefined,
            },
            chordGroup,
        );
        const added = scoreStore.addNotes(notes); // 整组一次写入，只触发一次渲染
        if (!added.ok) {
            setStatus(added.reason ?? t('note.status.addChordFailed'), 'error');
            return;
        }

        uiStore.resetChordFrets();
        uiStore.resetArpeggio();
        uiStore.resetStrum();

        // 重置和弦网格 UI
        const cc = document.getElementById('chordGridCells');
        if (cc) cc.querySelectorAll('.chord-grid-cell.selected').forEach(c => c.classList.remove('selected'));
        updateArpeggioButton();
        updateStrumButton();

        setStatus(t('note.status.chordAdded', {
            measure: scoreStore.activeMeasureIndex() + 1,
            chord: chordName ? `(${chordName}) ` : '',
            strings: active.length,
            arpeggio: hadArpeggio ? t('note.suffix.arpeggio') : '',
        }), 'success');
    });
}
