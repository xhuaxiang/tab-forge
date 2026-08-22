/**
 * eventHandlers — 事件绑定
 *
 * 所有 DOM 事件监听器集中在此。
 * 不处理 UI 自身逻辑（如和弦网格），只做事件到 store action 的桥接。
 */

import type { Note } from './types/index.ts';
import { TUNING_PRESETS } from './types/index.ts';
import { exportToAsciiTab, exportToJson } from './tabRenderer.ts';
import { $, setStatus, render, setRenderMode, getSearchSelectValue, durationName } from './state.ts';
import { canAddToMeasure } from './utils/measureUtils.ts';
import { scoreStore } from './stores/scoreStore.ts';
import { uiStore } from './stores/uiStore.ts';
import { initChordGrid, CHORD_PRESETS, updateStrumButton, updateArpeggioButton } from './chordInput.ts';
import { getApiKey, saveApiKey, generateImprovisation, type GenerationOptions } from './improvisation/index.ts';

// ============================================================
// Search-Select 事件
// ============================================================

function closeAllSelects(): void {
    document.querySelectorAll('.search-select.open').forEach(el => el.classList.remove('open'));
}

// ============================================================
// 内部工具
// ============================================================

function getTargetFret(): number | undefined {
    const input = document.getElementById('targetFret') as HTMLInputElement;
    if (!input) return undefined;
    const v = parseInt(input.value, 10);
    return (isNaN(v) || v < 0 || v > 24) ? undefined : v;
}

function isTieActive(): boolean {
    return document.querySelector('.tech-btn[data-tech="tie"]')?.classList.contains('active') ?? false;
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

    document.querySelectorAll('.tech-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tech = (btn as HTMLElement).dataset.tech;
            document.querySelectorAll('.tech-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            uiStore.setTechnique(tech as 'none' | 'hammerOn' | 'pullOff' | 'slide' | 'bend' | 'vibrato');

            // H/P/S 技法显示目标品输入框，推弦显示推弦选项，揉弦无需额外选项
            const tfRow = (document.getElementById('targetFret') as HTMLElement)?.closest('.input-group') as HTMLElement;
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
        });
    });

    // --- 小节操作 ---
    $('addMeasure')?.addEventListener('click', () => {
        const n = scoreStore.addMeasure();
        render();
        setStatus(`已添加小节 ${n}`, 'success');
    });

    $('deleteMeasure')?.addEventListener('click', () => {
        if (!scoreStore.deleteLastMeasure()) {
            setStatus('无小节可删', 'error');
            return;
        }
        render();
        setStatus('已删除最后一个小节', 'info');
    });

    $('clearBtn')?.addEventListener('click', () => {
        if (scoreStore.score.measures.length === 0) {
            setStatus('已是空状态', 'info');
            return;
        }
        if (confirm('确定清空所有小节？')) {
            scoreStore.clear();
            render();
            setStatus('已清空', 'info');
        }
    });

    // --- AI 即兴生成 ---
    // 初始化 API Key 输入框
    initAIKeyInput();

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
        const stringNum = getSearchSelectValue('stringSelect');
        const fret = getSearchSelectValue('fretSelect');
        const durSel = $('inputDuration') as HTMLSelectElement;
        const duration = parseFloat(durSel?.value || '0.25') as Note['duration'];

        if (stringNum < 1 || stringNum > 6) { setStatus('弦号 1-6', 'error'); return; }
        if (fret < 0 || fret > 24) { setStatus('品位 0-24', 'error'); return; }
        if (duration <= 0) { setStatus('无效时值', 'error'); return; }

        const measure = scoreStore.getActiveMeasure();
        if (!canAddToMeasure(measure, duration)) {
            setStatus(`节拍已满（${measure.timeSignatureNumerator}/${measure.timeSignatureDenominator}）`, 'error');
            return;
        }
        console.log(measure)
        const isTie = isTieActive();
        const tech = uiStore.currentTechnique;
        const hasTech = tech !== 'none';
        const targetFret = hasTech ? getTargetFret() : undefined;

        if (!isTie && hasTech && tech !== 'bend' && tech !== 'vibrato') {
            const notes = measure.notes
            const prevFret = notes[notes.length - 1].targetFret || notes[notes.length - 1].fret
            if (targetFret === prevFret) {
                setStatus('请选择目标品', 'error');
                return;
            }
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

        scoreStore.addNote(note);
        render();

        let suffix = '';
        if (isTie) suffix = ' (延音)';
        if (hasTech) {
            const labels: Record<string, string> = { hammerOn: '击弦H', pullOff: '勾弦P', slide: '滑弦S', bend: '推弦B', vibrato: '揉弦~' };
            suffix += ` (${labels[tech] || tech})`;
            if (tech === 'bend') {
                const amountLabels: Record<number, string> = { 0.25: '1/4', 0.5: '1/2', 1: 'Full' };
                suffix += ` ${amountLabels[uiStore.bendAmount] || uiStore.bendAmount}`;
                if (uiStore.bendRelease) suffix += ' 释放';
            } else if (targetFret !== undefined) {
                suffix += ` →${targetFret}品`;
            }
        }
        setStatus(`已添加: 第${stringNum}弦 ${fret}品 ${durationName(duration)}${suffix}`, 'success');
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
        render();
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

        render();
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
        render();
        setStatus(`调弦: ${sel.value}`, 'success');
    });

    for (let i = 1; i <= 6; i++) {
        $(`tuning${i}`)?.addEventListener('change', (e) => {
            const inp = e.target as HTMLInputElement;
            scoreStore.setStringTuning(i, inp.value);
            render();
            setStatus(`第${i}弦 = ${inp.value}`, 'info');
        });
    }

    // --- 播放 ---
    $('playBtn')?.addEventListener('click', async () => {
        if (scoreStore.score.measures.length === 0) { setStatus('无内容', 'error'); return; }
        const playBtn = $('playBtn')!;
        const stopBtn = $('stopBtn')!;
        const callbacks: import('./audioEngine.ts').PlaybackCallbacks = {
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
                const { alphaTabPlayer } = await import('./alphaTab/alphaTabPlayer.ts');
                alphaTabPlayer.setCallbacks(callbacks);
                await alphaTabPlayer.play(scoreStore.score);
                return;
            } catch (e) {
                console.error('alphaTab 播放失败，回退 Karplus-Strong', e);
                setStatus('SoundFont 播放失败，已回退合成器', 'error');
            }
        }
        const audioEngine = (await import('./audioEngine.ts')).currentAudioEngine;
        audioEngine.setCallbacks(callbacks);
        await audioEngine.play(scoreStore.score);
    });

    $('stopBtn')?.addEventListener('click', async () => {
        const { currentAudioEngine } = await import('./audioEngine.ts');
        currentAudioEngine.stop();
        const { alphaTabPlayer } = await import('./alphaTab/alphaTabPlayer.ts');
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
        scoreStore.setBpm(isNaN(v) ? 120 : v);
        bpmInput.value = String(scoreStore.score.bpm);
        render();
        setStatus(`BPM: ${scoreStore.score.bpm}`, 'info');
    });
    bpmInc?.addEventListener('click', () => {
        scoreStore.setBpm(scoreStore.score.bpm + 5);
        bpmInput.value = String(scoreStore.score.bpm);
        render();
        setStatus(`BPM: ${scoreStore.score.bpm}`, 'info');
    });
    bpmDec?.addEventListener('click', () => {
        scoreStore.setBpm(scoreStore.score.bpm - 5);
        bpmInput.value = String(scoreStore.score.bpm);
        render();
        setStatus(`BPM: ${scoreStore.score.bpm}`, 'info');
    });

    // --- 调性 ---
    const keySelect = $('keySelect') as HTMLSelectElement;
    if (keySelect) {
        keySelect.value = scoreStore.score.key || 'C';
        keySelect.addEventListener('change', () => {
            scoreStore.setKey(keySelect.value);
            render();
            setStatus(`调性: ${keySelect.value}`, 'info');
        });
    }

    // --- 全局拍号 ---
    const timeSigSelect = $('timeSigSelect') as HTMLSelectElement;
    if (timeSigSelect) {
        timeSigSelect.value = scoreStore.score.timeSignature;
        timeSigSelect.addEventListener('change', () => {
            scoreStore.setTimeSignature(timeSigSelect.value);
            render();
            setStatus(`拍号: ${timeSigSelect.value}`, 'info');
        });
    }

    // --- 导出 ---
    $('exportTopBtn')?.addEventListener('click', handleExport);
}

// ============================================================
// AI 即兴生成
// ============================================================

/** 初始化 API Key 输入框（从存储中加载已保存的 Key） */
async function initAIKeyInput(): Promise<void> {
    const input = document.getElementById('aiApiKey') as HTMLInputElement;
    if (!input) return;
    const saved = await getApiKey();
    if (saved) {
        input.value = saved;
    }
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

    const numMeasures = parseInt((document.getElementById('aiNumMeasures') as HTMLSelectElement)?.value || '4', 10);
    const scaleType = (document.getElementById('aiScaleType') as HTMLSelectElement)?.value || 'Major (Ionian)';
    const style = (document.getElementById('aiStyle') as HTMLSelectElement)?.value || 'Jazz';
    const density = (document.getElementById('aiDensity') as HTMLSelectElement)?.value || '中';
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

        render();
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
