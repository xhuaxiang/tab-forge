/**
 * eventHandlers — 事件绑定
 *
 * 所有 DOM 事件监听器集中在此。
 * 不处理 UI 自身逻辑（如和弦网格），只做事件到 store action 的桥接。
 */

import type { Note, TabScore } from '../types/index.ts';
import { TUNING_PRESETS } from '../types/index.ts';
import { exportToAsciiTab, exportToJson } from '../utils/tabExport.ts';
import { $, setStatus, setRenderMode, durationName } from './state.ts';
import { canAddToMeasure } from '../utils/measureUtils.ts';
import { scoreStore } from '../stores/scoreStore.ts';
import { uiStore } from '../stores/uiStore.ts';
import { initChordGrid, CHORD_PRESETS, updateStrumButton, updateArpeggioButton } from './chordInput.ts';
import { getApiKey, saveApiKey, generateImprovisation, type GenerationOptions } from '../improvisation/index.ts';
import { SCORE_DEFAULTS, IMPROV_CONFIG } from '../config.ts';
import type { Tuning } from '../types/index.ts';
import { buildNoteFromForm, updateTechniqueUI, isTieActive, type AppTechnique } from '../alphaTab/scoreEditing.ts';

// ============================================================
// Search-Select 事件
// ============================================================

function closeAllSelects(): void {
    document.querySelectorAll('.search-select.open').forEach(el => el.classList.remove('open'));
}

// ============================================================
// 事件绑定入口
// ============================================================

export function initEventListeners(): void {
    // ============================================================
    // DOM 初始化
    // ============================================================

    // 生成 fretSelect 选项
    const fretOpts = document.getElementById('fretSelect')?.querySelector('.options-list');
    if (fretOpts) {
        fretOpts.innerHTML = '';
        for (let f = 0; f <= 24; f++) {
            const div = document.createElement('div');
            div.className = 'option' + (f === 0 ? ' selected' : '');
            div.dataset.value = String(f);
            div.innerHTML = `第 ${f} 品 <span class="option-note">${f === 0 ? '空弦' : `${f}品`}</span>`;
            fretOpts.appendChild(div);
        }
    }

    // 和弦网格
    initChordGrid();

    // 默认隐藏目标品位输入
    const tfRow = (document.getElementById('targetFret') as HTMLElement)?.closest('.input-group') as HTMLElement;
    if (tfRow) tfRow.style.display = 'none';

    // ============================================================
    // Search-Select 事件
    // ============================================================

    document.querySelectorAll<HTMLElement>('.search-select').forEach(container => {
        const trigger = container.querySelector('.search-select-trigger') as HTMLElement;
        const searchInput = container.querySelector('.search-input') as HTMLInputElement;
        const optionsList = container.querySelector('.options-list') as HTMLElement;
        if (!trigger) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = container.classList.contains('open');
            closeAllSelects();
            if (!wasOpen) {
                container.classList.add('open');
                setTimeout(() => searchInput?.focus(), 50);
            }
        });

        searchInput?.addEventListener('input', () => {
            const q = searchInput.value.toLowerCase();
            const opts = optionsList.querySelectorAll('.option');
            let has = false;
            opts.forEach(o => {
                const m = (o.textContent || '').toLowerCase().includes(q);
                o.classList.toggle('hidden', !m);
                if (m) has = true;
            });
            const old = optionsList.querySelector('.no-results');
            if (old) old.remove();
            if (!has) {
                const nr = document.createElement('div');
                nr.className = 'no-results';
                nr.textContent = '无匹配';
                optionsList.appendChild(nr);
            }
        });

        optionsList?.addEventListener('click', (e) => {
            const opt = (e.target as HTMLElement).closest('.option') as HTMLElement;
            if (!opt || opt.classList.contains('no-results')) return;
            const val = opt.dataset.value;
            optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            const tv = container.querySelector('.trigger-value');
            if (tv) tv.textContent = val || '0';
            container.dataset.value = val || '0';
            container.classList.remove('open');
            if (searchInput) searchInput.value = '';
            optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('hidden'));
        });
    });

    document.addEventListener('click', closeAllSelects);

    // ============================================================
    // 技法栏事件
    // ============================================================

    document.querySelectorAll<HTMLElement>('.tech-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tech = btn.dataset.tech as string;
            if (tech === 'tie') {
                // 延音标记独立切换，不改技法
                btn.classList.toggle('active');
                uiStore.tieActive = btn.classList.contains('active');
                return;
            }
            updateTechniqueUI(tech as AppTechnique);
        });
    });

    // --- 小节操作 ---
    $('addMeasure')?.addEventListener('click', () => {
        const n = scoreStore.addMeasure();
        setStatus(`已添加小节 ${n}`, 'success');
    });

    $('deleteMeasure')?.addEventListener('click', () => {
        if (!scoreStore.deleteLastMeasure()) {
            setStatus('无小节可删', 'error');
            return;
        }
        setStatus('已删除最后一个小节', 'info');
    });

    $('clearBtn')?.addEventListener('click', () => {
        if (scoreStore.score.measures.length === 0) {
            setStatus('已是空状态', 'info');
            return;
        }
        if (confirm('确定清空所有小节？')) {
            scoreStore.clear();
            // [Phase 2] 清空恢复：导入后锁定渲染切换，清空时在此解锁 rendererSwitch
            setStatus('已清空', 'info');
        }
    });

    // --- AI 即兴生成 ---
    // 初始化 API Key 输入框 + 选项下拉（从 IMPROV_CONFIG 生成）
    initAIKeyInput();
    initImprovConfig();
    syncScoreDefaultsToUI();

    // Toolbar 快速按钮：打开 AI 设置面板
    $('aiImprovBtn')?.addEventListener('click', () => {
        const panel = document.getElementById('aiSettingsPanel') as HTMLDetailsElement;
        if (panel) {
            panel.open = true;
            panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // AI 生成按钮
    $('aiGenerateBtn')?.addEventListener('click', handleAIGenerate);

    // --- 添加音符 ---
    $('addNoteBtn')?.addEventListener('click', () => {
        const measure = scoreStore.getActiveMeasure();
        const durSel = $('inputDuration') as HTMLSelectElement | null;
        const duration = parseFloat(durSel?.value || '0.25') as Note['duration'];
        if (!canAddToMeasure(measure, duration)) {
            setStatus(`节拍已满（${measure.timeSignatureNumerator}/${measure.timeSignatureDenominator}）`, 'error');
            return;
        }
        const built = buildNoteFromForm(true);
        if (!built.note) {
            setStatus(built.error ?? '表单值无效', 'error');
            return;
        }
        const note = built.note;
        const stringNum = note.string ?? 1;
        const fret = note.fret ?? 0;
        const isTie = isTieActive();
        const tech = note.technique;
        const hasTech = tech !== undefined;

        scoreStore.addNote(note);

        let suffix = '';
        if (isTie) suffix = ' (延音)';
        if (hasTech) {
            const labels: Record<string, string> = { hammerOn: '击弦H', pullOff: '勾弦P', slide: '滑弦S', bend: '推弦B', vibrato: '揉弦~' };
            suffix += ` (${labels[tech] || tech})`;
            if (tech === 'bend') {
                const amountLabels: Record<number, string> = { 0.25: '1/4', 0.5: '1/2', 1: 'Full' };
                suffix += ` ${amountLabels[uiStore.bendAmount] || uiStore.bendAmount}`;
                if (uiStore.bendRelease) suffix += ' 释放';
            } else if (note.targetFret !== undefined) {
                suffix += ` →${note.targetFret}品`;
            }
        }
        setStatus(`已添加: 第${stringNum}弦 ${fret}品 ${durationName(note.duration)}${suffix}`, 'success');
    });

    // --- 休止符 ---
    $('addRestBtn')?.addEventListener('click', () => {
        const durSel = $('inputDuration') as HTMLSelectElement;
        const duration = parseFloat(durSel?.value || '0.25');
        if (duration <= 0) { setStatus('无效时值', 'error'); return; }
        const measure = scoreStore.getActiveMeasure();
        if (!canAddToMeasure(measure, duration)) {
            setStatus('节拍已满', 'error');
            return;
        }
        scoreStore.addRest(duration);
        setStatus(`已添加 ${durationName(duration)} 休止符`, 'success');
    });

    // --- 推弦幅度按钮 ---
    document.querySelectorAll('.bend-amount-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.bend-amount-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const amount = parseFloat((btn as HTMLElement).dataset.bendAmount || '1');
            uiStore.bendAmount = amount;
        });
    });

    // --- 推弦释放切换 ---
    $('bendReleaseToggle')?.addEventListener('click', () => {
        const btn = $('bendReleaseToggle')!;
        uiStore.bendRelease = !uiStore.bendRelease;
        btn.classList.toggle('active', uiStore.bendRelease);
    });

    // --- 琶音切换 ---
    const arpBtn = $('arpeggioToggle');
    arpBtn?.addEventListener('click', () => {
        uiStore.cycleArpeggio();
        updateArpeggioButton();
        if (uiStore.currentArpeggio === 'up') {
            setStatus('琶音: 从低到高', 'info');
        } else if (uiStore.currentArpeggio === 'down') {
            setStatus('琶音: 从高到低', 'info');
        } else {
            setStatus('琶音: 关闭', 'info');
        }
    });

    // --- 扫弦切换 ---
    const strumBtn = $('strumToggle');
    strumBtn?.addEventListener('click', () => {
        uiStore.toggleStrum();
        updateStrumButton();
        if (uiStore.currentStrum === 'down') {
            setStatus('扫弦: 下扫 (低→高)', 'info');
        } else if (uiStore.currentStrum === 'up') {
            setStatus('扫弦: 上扫 (高→低)', 'info');
        } else {
            setStatus('扫弦: 关闭', 'info');
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
        const durSel = document.getElementById('chordDuration') as HTMLSelectElement;
        const duration = parseFloat(durSel?.value || '0.25') as Note['duration'];
        if (duration <= 0) { setStatus('无效时值', 'error'); return; }

        const active: { string: number; fret: number }[] = [];
        for (let s = 0; s < 6; s++) {
            if (uiStore.currentChordFrets[s] >= 0 && uiStore.currentChordFrets[s] <= 5) {
                active.push({ string: s + 1, fret: uiStore.currentChordFrets[s] });
            }
        }
        if (active.length === 0) { setStatus('请选择至少一根弦的品位', 'error'); return; }

        const measure = scoreStore.getActiveMeasure();
        if (!canAddToMeasure(measure, duration)) {
            setStatus('节拍已满', 'error');
            return;
        }

        // 生成唯一和弦分组ID
        const chordGroup = Date.now();

        // 匹配预设和弦名称
        const matched = CHORD_PRESETS.find(p => p.frets.every((f, i) => f === uiStore.currentChordFrets[i]));
        const chordName = matched ? matched.name : '';

        // 按顺序添加和弦中的每个音符，共享 chordGroup
        active.forEach((n, i) => {
            const note: Note = {
                string: n.string,
                fret: n.fret,
                duration,
                chordGroup,
                chordName: i === 0 ? chordName : undefined,
                arpeggio: i === 0 ? (uiStore.currentArpeggio || undefined) : undefined,
                strum: i === 0 ? (uiStore.currentStrum || undefined) : undefined,
            };
            scoreStore.addNote(note);
        });

        uiStore.resetChordFrets();
        uiStore.resetArpeggio();
        uiStore.resetStrum();

        // 重置和弦网格 UI
        const cc = document.getElementById('chordGridCells');
        if (cc) cc.querySelectorAll('.chord-grid-cell.selected').forEach(c => c.classList.remove('selected'));
        updateArpeggioButton();
        updateStrumButton();

        setStatus(`已添加和弦${chordName ? ' (' + chordName + ')' : ''}: ${active.length}弦${uiStore.currentArpeggio ? ' 琶音' : ''}`, 'success');
    });

    // --- 调弦 ---
    $('tuningPreset')?.addEventListener('change', (e) => {
        const sel = e.target as HTMLSelectElement;
        const preset = TUNING_PRESETS[sel.value];
        if (!preset) return;
        scoreStore.setTuning(preset);
        for (let i = 1; i <= 6; i++) {
            const inp = $(`tuning${i}`) as HTMLInputElement;
            if (inp) inp.value = preset[`string${i}` as keyof typeof preset];
        }
        setStatus(`调弦: ${sel.value}`, 'success');
    });

    for (let i = 1; i <= 6; i++) {
        $(`tuning${i}`)?.addEventListener('change', (e) => {
            const inp = e.target as HTMLInputElement;
            scoreStore.setStringTuning(i, inp.value);
                setStatus(`第${i}弦 = ${inp.value}`, 'info');
        });
    }

    // --- 播放 ---
    $('playBtn')?.addEventListener('click', async () => {
        if (scoreStore.score.measures.length === 0) { setStatus('无内容', 'error'); return; }
        const playBtn = $('playBtn')!;
        const stopBtn = $('stopBtn')!;
        const callbacks: import('../playback/index.ts').PlaybackCallbacks = {
            onStateChange: (s) => {
                playBtn.textContent = s === 'playing' ? '⏸ 暂停' : (s === 'paused' ? '▶ 继续' : '▶ 播放');
                stopBtn.toggleAttribute('disabled', s === 'stopped');
            },
            onPositionChange: (mi) => setStatus(`播放: 小节 ${mi + 1}/${scoreStore.score.measures.length}`, 'info'),
            onComplete: () => {
                setStatus('播放完成', 'success');
                playBtn.textContent = '▶ 播放';
                stopBtn.setAttribute('disabled', '');
            },
        };
        const engine = ($('engineSelect') as HTMLSelectElement | null)?.value ?? 'ks';
        if (engine === 'alphatab') {
            try {
                const { alphaTabPlayer } = await import('../playback/soundfont/index.ts');
                alphaTabPlayer.setCallbacks(callbacks);
                await alphaTabPlayer.play(scoreStore.score);
                return;
            } catch (e) {
                console.error('alphaTab 播放失败，回退 Karplus-Strong', e);
                setStatus('SoundFont 播放失败，已回退合成器', 'error');
            }
        }
        const audioEngine = (await import('../playback/karplus/index.ts')).currentAudioEngine;
        audioEngine.setCallbacks(callbacks);
        await audioEngine.play(scoreStore.score);
    });

    $('stopBtn')?.addEventListener('click', async () => {
        const { currentAudioEngine } = await import('../playback/karplus/index.ts');
        currentAudioEngine.stop();
        const { alphaTabPlayer } = await import('../playback/soundfont/index.ts');
        alphaTabPlayer.stop();
        setStatus('已停止', 'info');
    });

    // --- 录音 ---
    $('recordBtn')?.addEventListener('click', async () => {
        const btn = $('recordBtn')!;
        const st = $('audioStatus')!;
        const { currentAudioRecorder } = await import('./recorder.ts');
        if (currentAudioRecorder.getIsRecording()) {
            const blob = currentAudioRecorder.stopRecording();
            btn.textContent = '⏺ 录音';
            btn.classList.remove('recording');
            st.textContent = blob ? `完成: ${(blob.size / 1024).toFixed(1)} KB` : '已停止';
            setStatus(blob ? '录音完成' : '已停止', blob ? 'success' : 'info');
        } else {
            const ok = await currentAudioRecorder.startRecording();
            if (ok) {
                btn.textContent = '⏹ 停止';
                btn.classList.add('recording');
                st.textContent = '🔴 录音中...';
                setStatus('录音中', 'info');
            } else {
                st.textContent = '启动失败';
                setStatus('麦克风权限被拒', 'error');
            }
        }
    });

    // --- Tab 导航 ---
    document.querySelectorAll('.tab-nav button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-nav button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // --- 渲染方式切换（画布 / alphaTab） ---
    document.querySelectorAll('#rendererSwitch button').forEach(btn => {
        btn.addEventListener('click', async () => {
            const mode = btn.getAttribute('data-render');
            if (mode !== 'canvas' && mode !== 'alphaTab') return;
            document.querySelectorAll('#rendererSwitch button').forEach(b => {
                b.classList.toggle('active', b === btn);
            });
            try {
                await setRenderMode(mode);
                setStatus(mode === 'alphaTab' ? '已切换到 alphaTab 渲染' : '已切换到画布渲染', 'info');
            } catch (e) {
                console.error('切换渲染器失败，回退画布', e);
                setStatus('alphaTab 渲染初始化失败，已回退画布', 'error');
                document.querySelectorAll('#rendererSwitch button').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-render') === 'canvas');
                });
                await setRenderMode('canvas');
            }
        });
    });

    // --- BPM ---
    const bpmInput = $('bpmInput') as HTMLInputElement;
    const bpmInc = $('bpmIncBtn');
    const bpmDec = $('bpmDecBtn');

    bpmInput?.addEventListener('change', () => {
        const v = parseInt(bpmInput.value, 10);
        scoreStore.setBpm(isNaN(v) ? SCORE_DEFAULTS.bpm : v);
        bpmInput.value = String(scoreStore.score.bpm);
        setStatus(`BPM: ${scoreStore.score.bpm}`, 'info');
    });
    bpmInc?.addEventListener('click', () => {
        scoreStore.setBpm(scoreStore.score.bpm + 5);
        bpmInput.value = String(scoreStore.score.bpm);
        setStatus(`BPM: ${scoreStore.score.bpm}`, 'info');
    });
    bpmDec?.addEventListener('click', () => {
        scoreStore.setBpm(scoreStore.score.bpm - 5);
        bpmInput.value = String(scoreStore.score.bpm);
        setStatus(`BPM: ${scoreStore.score.bpm}`, 'info');
    });

    // --- 调性 ---
    const keySelect = $('keySelect') as HTMLSelectElement;
    if (keySelect) {
        keySelect.value = scoreStore.score.key || 'C';
        keySelect.addEventListener('change', () => {
            scoreStore.setKey(keySelect.value);
                setStatus(`调性: ${keySelect.value}`, 'info');
        });
    }

    // --- 全局拍号 ---
    const timeSigSelect = $('timeSigSelect') as HTMLSelectElement;
    if (timeSigSelect) {
        timeSigSelect.value = scoreStore.score.timeSignature;
        timeSigSelect.addEventListener('change', () => {
            scoreStore.setTimeSignature(timeSigSelect.value);
                setStatus(`拍号: ${timeSigSelect.value}`, 'info');
        });
    }

    // --- PDF 导入 ---
    $('importPdfBtn')?.addEventListener('click', () => {
        ($('pdfFileInput') as HTMLInputElement | null)?.click();
    });
    $('pdfFileInput')?.addEventListener('change', handlePdfImport);

    // --- 导出 ---
    $('exportTopBtn')?.addEventListener('click', handleExport);
}

// ============================================================
// PDF 导入
// ============================================================

/** 处理「导入 PDF」文件选择 */
async function handlePdfImport(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = ''; // 重置：同一文件可再次导入
    setStatus(`⏳ 正在解析 ${file.name}...`, 'info');
    try {
        const buf = await file.arrayBuffer();
        const { parsePdfFile } = await import('../pdfImport/index.ts'); // 懒加载，保持主包轻量
        const score = await parsePdfFile(buf, (msg) => setStatus(msg, 'info'));
        if (score.measures.length === 0) {
            setStatus('未识别到可导入的六线谱内容', 'error');
            return;
        }
        scoreStore.loadScore(score);
        // [Phase 2] 导入后强制 alphaTab 渲染 + 锁定 rendererSwitch
        syncImportedScoreToUI(score);
        setStatus(`✅ 已导入 ${score.measures.length} 小节（${score.title || '未知标题'}）`, 'success');
    } catch (err) {
        console.error('PDF 导入失败', err);
        setStatus(`PDF 导入失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
}

/** 导入后把 key / 拍号 / BPM 同步到工具栏控件（避免 UI 值与 store 不一致） */
function syncImportedScoreToUI(score: TabScore): void {
    const keySel = document.getElementById('keySelect') as HTMLSelectElement | null;
    if (keySel && score.key) keySel.value = score.key;
    const tsSel = document.getElementById('timeSigSelect') as HTMLSelectElement | null;
    if (tsSel) tsSel.value = score.timeSignature;
    const bpm = document.getElementById('bpmInput') as HTMLInputElement | null;
    if (bpm) bpm.value = String(score.bpm);
}

// ============================================================
// AI 即兴生成
// ============================================================

/** 从 IMPROV_CONFIG 生成即兴选项下拉（小节数/音阶/风格/密度），单一来源 */
function initImprovConfig(): void {
    const fillSelect = (id: string, options: ReadonlyArray<{ value: string; label: string }>, defaultVal: string): void => {
        const sel = document.getElementById(id) as HTMLSelectElement | null;
        if (!sel) return;
        sel.innerHTML = '';
        for (const o of options) {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            if (o.value === defaultVal) opt.selected = true;
            sel.appendChild(opt);
        }
    };

    const numSel = document.getElementById('aiNumMeasures') as HTMLSelectElement | null;
    if (numSel) {
        numSel.innerHTML = '';
        for (const n of IMPROV_CONFIG.numMeasures.options) {
            const opt = document.createElement('option');
            opt.value = String(n);
            opt.textContent = String(n);
            if (n === IMPROV_CONFIG.numMeasures.default) opt.selected = true;
            numSel.appendChild(opt);
        }
    }
    fillSelect('aiScaleType', IMPROV_CONFIG.scaleTypes, IMPROV_CONFIG.scaleTypes[0].value);
    fillSelect('aiStyle', IMPROV_CONFIG.styles, IMPROV_CONFIG.styles[0].value);
    fillSelect('aiDensity', IMPROV_CONFIG.densities, IMPROV_CONFIG.densities[1].value);
}

/** 把 SCORE_DEFAULTS 同步到页面控件（调性/BPM/调弦/预设），单一来源 */
function syncScoreDefaultsToUI(): void {
    const { key, bpm, tuning } = SCORE_DEFAULTS;

    const keySel = document.getElementById('keySelect') as HTMLSelectElement | null;
    if (keySel) keySel.value = key;

    const bpmInput = document.getElementById('bpmInput') as HTMLInputElement | null;
    if (bpmInput) bpmInput.value = String(bpm);

    for (let i = 1; i <= 6; i++) {
        const input = document.getElementById(`tuning${i}`) as HTMLInputElement | null;
        if (input) input.value = tuning[`string${i}` as keyof Tuning];
    }

    const presetSel = document.getElementById('tuningPreset') as HTMLSelectElement | null;
    if (presetSel) {
        const match = Object.entries(TUNING_PRESETS).find(([, t]) => isTuningEqual(t, tuning));
        presetSel.value = match ? match[0] : 'standard';
    }
}

function isTuningEqual(a: Tuning, b: Tuning): boolean {
    return a.string1 === b.string1 && a.string2 === b.string2 && a.string3 === b.string3
        && a.string4 === b.string4 && a.string5 === b.string5 && a.string6 === b.string6;
}

/** 初始化 API Key 输入框（从存储中加载已保存的 Key） */
async function initAIKeyInput(): Promise<void> {
    const input = document.getElementById('aiApiKey') as HTMLInputElement;
    if (!input) return;
    const saved = await getApiKey();
    if (saved) {
        input.value = saved;
    }
    // API Key 在 summary 右侧：点击输入框不折叠面板
    input.addEventListener('click', (e) => e.stopPropagation());
    // 修改时自动保存
    input.addEventListener('change', () => {
        saveApiKey(input.value.trim());
    });
}

/** 处理 AI 生成按钮点击 */
async function handleAIGenerate(): Promise<void> {
    const apiKeyInput = document.getElementById('aiApiKey') as HTMLInputElement;
    const statusEl = document.getElementById('aiGenStatus');
    const btn = document.getElementById('aiGenerateBtn') as HTMLButtonElement;

    const apiKey = apiKeyInput?.value?.trim();
    if (!apiKey) {
        setStatus('请先输入 DeepSeek API Key', 'error');
        if (statusEl) statusEl.textContent = '⚠️ 请先输入 API Key';
        return;
    }

    // 保存 Key
    await saveApiKey(apiKey);

    // 最少 3 小节，避免 AI 产出过短（如 1 拍）；默认值统一取 IMPROV_CONFIG
    const numMeasures = Math.max(IMPROV_CONFIG.numMeasures.min, parseInt((document.getElementById('aiNumMeasures') as HTMLSelectElement)?.value || String(IMPROV_CONFIG.numMeasures.default), 10));
    const scaleType = (document.getElementById('aiScaleType') as HTMLSelectElement)?.value || IMPROV_CONFIG.scaleTypes[0].value;
    const style = (document.getElementById('aiStyle') as HTMLSelectElement)?.value || IMPROV_CONFIG.styles[0].value;
    const density = (document.getElementById('aiDensity') as HTMLSelectElement)?.value || IMPROV_CONFIG.densities[1].value;
    const extraPrompt = (document.getElementById('aiExtraPrompt') as HTMLInputElement)?.value?.trim();

    const options: GenerationOptions = {
        numMeasures,
        scaleType,
        style,
        density,
        extraPrompt: extraPrompt || undefined,
    };

    // UI 反馈：禁用按钮，显示加载状态
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 生成中...';
    }
    if (statusEl) statusEl.textContent = '⏳ 正在调用 DeepSeek AI...';
    setStatus('⏳ AI 正在生成即兴谱...', 'info');

    // 确保至少有一个小节
    if (scoreStore.score.measures.length === 0) {
        scoreStore.addMeasure();
    }

    try {
        const result = await generateImprovisation(scoreStore.score, options, apiKey);

        if (result.error) {
            setStatus(`AI 生成失败: ${result.error}`, 'error');
            if (statusEl) statusEl.textContent = `❌ ${result.error}`;
            return;
        }

        if (result.notes.length === 0) {
            setStatus('AI 未返回有效音符', 'error');
            if (statusEl) statusEl.textContent = '❌ AI 未返回有效音符';
            return;
        }

        // 先清空乐谱，再输出全新即兴（避免追加旧内容导致小节结构混乱/堆叠）
        scoreStore.beginBatch();
        scoreStore.clear();
        if (scoreStore.score.measures.length === 0) {
            scoreStore.addMeasure();
        }

        // 按 chordGroup 把连续音符分组为拍位：和弦整体进一小节，不被切开，容量按拍位计
        const slots: Note[][] = [];
        let current: Note[] = [];
        for (const n of result.notes) {
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
            let measure = scoreStore.getActiveMeasure();
            if (!canAddToMeasure(measure, dur)) {
                scoreStore.addMeasure();
                measure = scoreStore.getActiveMeasure();
            }
            if (slot[0].isRest) {
                scoreStore.addRest(dur);
                written++;
                continue;
            }
            // 和弦内同弦去重（避免同一 X 上音符重叠），其余按序写入
            const seenStrings = new Set<number>();
            for (const n of slot) {
                if (n.isRest || n.string === undefined) continue;
                if (seenStrings.has(n.string)) continue;
                seenStrings.add(n.string);
                scoreStore.addNote(n);
                written++;
            }
        }

        // 强制小节数：AI 按拍容量重排后可能少于配置数，补空小节到 numMeasures
        while (scoreStore.score.measures.length < numMeasures) {
            scoreStore.addMeasure();
        }
        scoreStore.endBatch(); // 批量结束，统一渲染一次

        setStatus(`✅ AI 已生成 ${written} 个音符`, 'success');
        if (statusEl) statusEl.textContent = `✅ 成功！已生成 ${result.notes.length} 个音符，${scoreStore.score.measures.length} 个小节`;
    } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误';
        setStatus(`AI 调用异常: ${msg}`, 'error');
        if (statusEl) statusEl.textContent = `❌ 异常: ${msg}`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🤖 生成即兴谱';
        }
    }
}

// ============================================================
// 导出 Modal
// ============================================================

function handleExport(): void {
    const ascii = exportToAsciiTab(scoreStore.score);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>📤 导出乐谱</h3>
            <div class="modal-actions">
                <button id="exportAsciiBtn">TAB 文本</button>
                <button id="exportJsonBtn">JSON</button>
                <button id="copyBtn" class="btn-copy">📋 复制</button>
            </div>
            <textarea class="modal-textarea" id="exportOutput" readonly>${ascii}</textarea>
            <div class="modal-footer">
                <button id="closeExportBtn">关闭</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const ta = modal.querySelector('#exportOutput') as HTMLTextAreaElement;
    modal.querySelector('#exportAsciiBtn')?.addEventListener('click', () => {
        ta.value = exportToAsciiTab(scoreStore.score);
    });
    modal.querySelector('#exportJsonBtn')?.addEventListener('click', () => {
        ta.value = exportToJson(scoreStore.score);
    });
    modal.querySelector('#copyBtn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(ta.value)
            .then(() => setStatus('已复制', 'success'))
            .catch(() => setStatus('复制失败', 'error'));
    });
    modal.querySelector('#closeExportBtn')?.addEventListener('click', () => document.body.removeChild(modal));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });
    
}
