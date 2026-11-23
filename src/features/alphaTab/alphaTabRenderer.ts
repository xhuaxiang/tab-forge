/**
 * alphaTabRenderer — alphaTab 专业谱面渲染（懒加载）
 *
 * 用 AlphaTabApi 把 TabScore 渲染成六线谱/五线谱。
 * - 主线程渲染（useWorkers=false）：绕开 worker 打包/通信与懒加载占位问题
 * - 播放走独立引擎（audioEngine / alphaTabPlayer），这里禁用 alphaTab 自带播放器
 * - mount 是异步（动态 import alphaTab）
 */

import type { TabScore, EditCursor } from '../../core/types/index.ts';
import { ALPHATAB_DISPLAY_SCALE, DEFAULT_DISPLAY_MODE, type DisplayMode } from '../../core/config.ts';
import { appStringToTabRow, beatOffsetInMeasure } from '../../core/utils/scoreMapping.ts';
import { measureTotalBeats } from '../../core/utils/measureUtils.ts';
import {
    makeStaffGrid,
    resolveSlotIndexAtX,
    tabRowAtY,
    tabRowY,
    type StaffAnchor,
} from '../../core/utils/tabGeometry.ts';
import { tabScoreToAlphaTabScore } from './scoreAdapter.ts';
import { handleScoreClick, type TabCellHit } from './scoreEditing.ts';
import { t } from '../../core/i18n/index.ts';

type AlphaTabModule = typeof import('@coderline/alphatab');
type AlphaTabBeat = import('@coderline/alphatab').model.Beat;
type AlphaTabNote = import('@coderline/alphatab').model.Note;

/** boundsLookup 的子集（model.BoundsLookup 未在类型里导出，用结构类型） */
interface BoundsLookupLike {
    getBeatAtPos(x: number, y: number): AlphaTabBeat | null;
    getNoteAtPos(beat: AlphaTabBeat, x: number, y: number): AlphaTabNote | null;
    staffSystems?: StaffSystemLike[];
}

interface SimpleBounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** BeatBounds 的子集：realBounds 供 x 定位，notes 提供弦行锚点 */
interface BeatBoundsLike {
    realBounds: SimpleBounds;
    beat: AlphaTabBeat;
    notes?: NoteBoundsLike[] | null;
    /** 在该拍位内按坐标找音符（优先用本行 bounds，避免命中另一谱表行） */
    findNoteAtPos?(x: number, y: number): AlphaTabNote | null;
}

/** NoteBounds 的子集：品位数字中心 y + alphaTab 弦号 */
interface NoteBoundsLike {
    noteHeadBounds: SimpleBounds;
    note: AlphaTabNote;
}

/** BarBounds 的子集；bar.staff.tuning 给出弦数，showTablature 用于识别六线谱行 */
interface BarBoundsLike {
    realBounds: SimpleBounds;
    beats: BeatBoundsLike[];
    bar: {
        staff: {
            tuning: number[];
            showTablature: boolean;
        };
    };
}

/** MasterBarBounds：index 即全局小节号（单轨），bars 为各谱表行（scoretab 下六线谱是最后一个） */
interface MasterBarBoundsLike {
    index: number;
    realBounds: SimpleBounds;
    bars: BarBoundsLike[];
}

/** 行(StaffSystem)内的 MasterBar bounds */
interface StaffSystemLike {
    realBounds: SimpleBounds;
    bars: MasterBarBoundsLike[];
}

export class AlphaTabRenderer {
    private api: import('@coderline/alphatab').AlphaTabApi | null = null;
    private mod: AlphaTabModule | null = null;
    private container: HTMLElement | null = null;
    private mounted = false;
    private boundsLookup: BoundsLookupLike | null = null;
    private unsubscribeRenderFinished: (() => void) | null = null;
    private emptyStateEl: HTMLElement | null = null;
    private highlightEl: HTMLElement | null = null;
    /** 当前渲染的应用乐谱（只读引用，用于把光标拍偏移与内容总拍数对齐） */
    private score: TabScore | null = null;
    /** 只读光标覆盖层：拍位列 + 弦行带 */
    private editCellEl: HTMLElement | null = null;
    private editRowEl: HTMLElement | null = null;
    private editCursor: EditCursor | null = null;
    /** 当前选中的小节号（-1 = 无）；由 scoreStore.selectMeasure → state 调用 setSelectedMeasure 维护 */
    private selectedMeasure = -1;
    /** 谱面显示模式；mount 时套用，切换时即时重渲染（跨 mount 保留） */
    private displayMode: DisplayMode = DEFAULT_DISPLAY_MODE;
    private readonly onClickBound = (e: MouseEvent): void => this.onContainerClick(e);

    /**
     * 切换显示模式（六线谱 / 五线+六线）。
     *
     * alphaTab 只在「纯六线谱」配置下画六线上的休止符（TabBarRenderer.showRests），
     * 时值/节奏符号另需显式打开 rhythmMode；两者都只改显示设置，不动谱面数据。
     */
    setDisplayMode(mode: DisplayMode): void {
        if (mode === this.displayMode) return;
        this.displayMode = mode;
        if (!this.api || !this.mod) return;
        this.applyDisplaySettings(this.api.settings, this.mod, mode);
        this.api.updateSettings();
        // 空谱（未 load）时 renderer 没有 score，等下次 render 时自然套用新设置
        if (this.api.score) this.api.render();
    }

    /**
     * 显示模式 → alphaTab 设置。
     *
     * 六线谱模式必须显式打开 rhythmMode：alphaTab 的 Automatic 判断看的是
     * `staff.showStandardNotation`（我们的模型始终为 true），而不是实际渲染出的谱表，
     * 所以只切 StaveProfile 时六线谱上只有休止符、没有时值/节奏符。
     */
    private applyDisplaySettings(
        settings: import('@coderline/alphatab').Settings,
        mod: AlphaTabModule,
        mode: DisplayMode,
    ): void {
        if (mode === 'tab') {
            settings.display.staveProfile = mod.StaveProfile.Tab;
            settings.notation.rhythmMode = mod.TabRhythmMode.ShowWithBars;
        } else {
            settings.display.staveProfile = mod.StaveProfile.Default;
            settings.notation.rhythmMode = mod.TabRhythmMode.Automatic;
        }
    }

    /** 设置选中小节（-1 取消），并即时绘制高亮框 */
    setSelectedMeasure(index: number): void {
        this.selectedMeasure = index;
        if (!this.mounted) return;
        this.applySelectionHighlight();
    }

    /** 用 boundsLookup 定位选中小节并挪动高亮覆盖框（每次渲染完成后也会重算） */
    private applySelectionHighlight(): void {
        const lookup = this.boundsLookup;
        if (!lookup || !this.container || this.selectedMeasure < 0) {
            this.hideHighlight();
            return;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const system of lookup.staffSystems ?? []) {
            for (const mb of system.bars) {
                if (mb.index !== this.selectedMeasure) continue;
                const b = mb.realBounds;
                minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
            }
        }
        if (!Number.isFinite(minX)) { this.hideHighlight(); return; }
        const off = this.surfaceOffset();
        if (!off) { this.hideHighlight(); return; }

        const pad = 3;
        const el = this.ensureHighlightEl();
        el.style.left = `${minX + off.offX - pad}px`;
        el.style.top = `${minY + off.offY - pad}px`;
        el.style.width = `${maxX - minX + pad * 2}px`;
        el.style.height = `${maxY - minY + pad * 2}px`;
        el.style.display = 'block';
    }

    /** alphaTab bounds 以 .at-surface 左上角为原点；返回相对容器的偏移 */
    private surfaceOffset(): { offX: number; offY: number } | null {
        if (!this.container) return null;
        const surface = this.container.querySelector('.at-surface') as HTMLElement | null;
        const base = surface ?? this.container;
        const baseRect = base.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        return { offX: baseRect.left - containerRect.left, offY: baseRect.top - containerRect.top };
    }

    private ensureHighlightEl(): HTMLElement {
        // alphaTab 每次 load 可能重建内部 DOM，覆盖框被移除时重新创建
        if (this.highlightEl && !this.highlightEl.isConnected) this.highlightEl = null;
        if (!this.highlightEl && this.container) {
            const el = document.createElement('div');
            el.className = 'at-measure-highlight';
            el.style.display = 'none';
            this.container.appendChild(el);
            this.highlightEl = el;
        }
        return this.highlightEl as HTMLElement;
    }

    private hideHighlight(): void {
        if (this.highlightEl) this.highlightEl.style.display = 'none';
    }

    // ============================================================
    // 只读光标覆盖层
    // ============================================================

    /** 设置只读光标（null = 隐藏）；不触任何数据变更 */
    setEditCursor(cursor: EditCursor | null): void {
        this.editCursor = cursor;
        if (!this.mounted) return;
        this.applyEditCursor();
    }

    /** 按当前光标重画拍位列与弦行带（renderFinished 后也会调用） */
    private applyEditCursor(): void {
        const cursor = this.editCursor;
        const lookup = this.boundsLookup;
        if (!cursor || !lookup || !this.container) { this.hideEditCursor(); return; }

        const mb = this.findMasterBarBounds(cursor.measureIndex);
        const tabBar = mb ? this.findTabBar(mb) : null;
        const off = this.surfaceOffset();
        if (!mb || !tabBar || !off) { this.hideEditCursor(); return; }

        const barBounds = tabBar.realBounds;
        const stringCount = tabBar.bar.staff.tuning.length;

        // 拍位列：有对应 beat 用其 realBounds；小节尾画在右端
        let columnX = barBounds.x;
        let columnW = 12;
        let foundBeat: BeatBoundsLike | null = null;
        for (const bb of tabBar.beats) {
            if (Math.abs(beatOffsetInMeasure(bb.beat) - cursor.beatOffset) < 1e-6) {
                foundBeat = bb;
                break;
            }
        }
        if (foundBeat) {
            const index = tabBar.beats.indexOf(foundBeat);
            columnX = foundBeat.realBounds.x;
            // 列宽取到下一拍起点，最后一拍画到小节右端（beat 的 realBounds 只有音符字形宽）
            const nextX = index >= 0 && index + 1 < tabBar.beats.length
                ? tabBar.beats[index + 1].realBounds.x
                : barBounds.x + barBounds.w;
            columnW = Math.max(nextX - columnX, 4);
        } else {
            // 没匹配到渲染 beat 时，只有「小节尾」可以画在右端；
            // 其它偏移说明光标与当前渲染错位，宁可不画也不画到错误位置。
            const measure = this.score?.measures[cursor.measureIndex];
            const total = measure ? measureTotalBeats(measure) : NaN;
            if (!Number.isFinite(total) || Math.abs(cursor.beatOffset - total) > 1e-6) {
                this.hideEditCursor();
                return;
            }
            columnW = Math.min(16, Math.max(6, barBounds.w * 0.06));
            columnX = barBounds.x + barBounds.w - columnW;
        }

        const cell = this.ensureEditEl('cell');
        cell.style.left = `${columnX + off.offX}px`;
        cell.style.top = `${barBounds.y + off.offY}px`;
        cell.style.width = `${columnW}px`;
        cell.style.height = `${barBounds.h}px`;
        cell.style.display = 'block';

        // 弦行带：用该谱表行的音符品位中心拟合行距；几何不可用时只画列
        if (stringCount >= 2 && barBounds.h > 0) {
            const grid = makeStaffGrid({
                anchors: this.collectStaffAnchors(tabBar, stringCount),
                fallbackTopY: barBounds.y,
                fallbackRowSpacing: barBounds.h / (stringCount - 1),
                stringCount,
            });
            const rowAlphaString = appStringToTabRow(cursor.string, stringCount);
            const rowY = tabRowY(grid, rowAlphaString);
            const spacing = grid.rowSpacing > 0 ? grid.rowSpacing : barBounds.h / (stringCount - 1);
            const rowH = Math.max(4, spacing * 0.7);
            const row = this.ensureEditEl('row');
            row.style.left = `${columnX + off.offX}px`;
            row.style.top = `${rowY + off.offY - rowH / 2}px`;
            row.style.width = `${columnW}px`;
            row.style.height = `${rowH}px`;
            row.style.display = 'block';
        } else if (this.editRowEl) {
            this.editRowEl.style.display = 'none';
        }
    }

    /** 收集谱表行内所有音符品位数字中心，作为行距拟合锚点 */
    private collectStaffAnchors(bar: BarBoundsLike, stringCount: number): StaffAnchor[] {
        const anchors: StaffAnchor[] = [];
        for (const bb of bar.beats) {
            for (const nb of bb.notes ?? []) {
                const row: number | undefined = nb.note?.string;
                if (row === undefined || row < 1 || row > stringCount) continue;
                const b = nb.noteHeadBounds;
                if (!b) continue;
                anchors.push({ y: b.y + b.h / 2, row });
            }
        }
        return anchors;
    }

    private ensureEditEl(kind: 'cell' | 'row'): HTMLElement {
        const get = (): HTMLElement | null => kind === 'cell' ? this.editCellEl : this.editRowEl;
        const set = (el: HTMLElement | null): void => {
            if (kind === 'cell') this.editCellEl = el;
            else this.editRowEl = el;
        };
        // alphaTab 每次 load 可能重建内部 DOM，覆盖层被移除时重新创建
        const existing = get();
        if (existing && !existing.isConnected) set(null);
        if (!get() && this.container) {
            const el = document.createElement('div');
            el.className = kind === 'cell' ? 'at-edit-cell' : 'at-edit-row';
            el.style.display = 'none';
            this.container.appendChild(el);
            set(el);
        }
        return get() as HTMLElement;
    }

    private hideEditCursor(): void {
        if (this.editCellEl) this.editCellEl.style.display = 'none';
        if (this.editRowEl) this.editRowEl.style.display = 'none';
    }

    /** boundsLookup 中按全局小节号找 MasterBarBounds（单轨单谱表） */
    private findMasterBarBounds(index: number): MasterBarBoundsLike | null {
        for (const system of this.boundsLookup?.staffSystems ?? []) {
            for (const mb of system.bars) {
                if (mb.index === index) return mb;
            }
        }
        return null;
    }

    /** 取 MasterBar 内的六线谱行：优先按 showTablature 识别，末行排序为兜底（scoretab 下六线谱通常最后） */
    private findTabBar(mb: MasterBarBoundsLike): BarBoundsLike | null {
        for (let i = mb.bars.length - 1; i >= 0; i--) {
            const bar = mb.bars[i];
            const staff = bar.bar?.staff;
            if (!staff?.showTablature || !(staff.tuning?.length > 1)) continue;
            return bar;
        }
        return null;
    }

    // ============================================================
    // 点击命中
    // ============================================================

    /**
     * 客户端坐标 → 六线谱单元（小节 × 拍位 × 弦）。
     *
     * 落在五线谱区域、几何不可用或容差外时返回 null，调用方回落到旧的 beat/note 命中。
     */
    hitTestTabCell(clientX: number, clientY: number): TabCellHit | null {
        const lookup = this.boundsLookup;
        if (!lookup || !this.container) return null;
        const local = this.toLocal(clientX, clientY);
        if (!local) return null;
        const { x, y } = local;

        const system = (lookup.staffSystems ?? []).find(s => {
            const b = s.realBounds;
            return b && y >= b.y && y <= b.y + b.h;
        });
        if (!system) return null;

        const mb = system.bars.find(b => x >= b.realBounds.x && x <= b.realBounds.x + b.realBounds.w);
        if (!mb) return null;

        const tabBar = this.findTabBar(mb);
        if (!tabBar) return null;

        // scoretab 模式下点在五线谱行：不接管，交给旧点击路径
        const rb = tabBar.realBounds;

        const stringCount = tabBar.bar.staff.tuning.length;
        if (!Number.isFinite(stringCount) || stringCount < 2) return null;

        // 拟合弦行网格（点击命中与覆盖层共用同一份行距）
        const grid = makeStaffGrid({
            anchors: this.collectStaffAnchors(tabBar, stringCount),
            fallbackTopY: rb.y,
            fallbackRowSpacing: rb.h / (stringCount - 1),
            stringCount,
        });

        // y 范围用拟合网格的行距：首线以上/末线以下各允许半行。
        // 品位数字字形比谱线高，固定 ±2px 会把数字上半/下半误判成谱外。
        const halfRow = grid.rowSpacing > 0 ? grid.rowSpacing / 2 : 0;
        const topLineY = tabRowY(grid, stringCount);
        const bottomLineY = tabRowY(grid, 1);
        if (y < topLineY - halfRow || y > bottomLineY + halfRow) return null;

        const beats = tabBar.beats.map(bb => ({ x: bb.realBounds.x, width: bb.realBounds.w }));
        const slot = resolveSlotIndexAtX(x, beats, { x: rb.x, width: rb.w });
        if (!slot) return null;

        // 该拍位的模型 beat（小节尾没有 beat）；点击行仍由网格反查
        const hitBeat = slot.kind === 'slot' ? (tabBar.beats[slot.index]?.beat ?? null) : null;
        const row = tabRowAtY(grid, y);

        // 先看是否点中该拍位的已有音符（弦号以 note.string 为准，修正行取整误差）。
        // 品位数字的 noteHeadBounds 很小，点偏一点就会 miss；此时用「拍位 + 点击行」
        // 直接命中模型音符，保证拾取到的弦品与点到的音符一致。
        let hitNote: AlphaTabNote | null = null;
        if (slot.kind === 'slot') {
            const bb = tabBar.beats[slot.index];
            if (bb) {
                hitNote = bb.findNoteAtPos ? bb.findNoteAtPos(x, y) : lookup.getNoteAtPos(bb.beat, x, y);
                if (!hitNote && row !== null) {
                    hitNote = (bb.beat.notes ?? []).find(n => n.string === row) ?? null;
                }
            }
        }

        let alphaString: number;
        if (hitNote && hitNote.string >= 1 && hitNote.string <= stringCount) {
            alphaString = hitNote.string;
        } else {
            if (row === null) return null; // 容差外：不定位弦（旧路径接手）
            alphaString = row;
        }

        return {
            measureIndex: mb.index,
            beatIndex: slot.kind === 'slot' ? slot.index : null,
            alphaString,
            note: hitNote,
            beat: hitBeat,
        };
    }

    /** 客户端坐标 → alphaTab surface 内部坐标 */
    private toLocal(clientX: number, clientY: number): { x: number; y: number } | null {
        if (!this.container) return null;
        const surface = this.container.querySelector('.at-surface') as HTMLElement | null;
        const el = surface ?? this.container;
        const rect = el.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    /** 是否已就绪（可渲染） */
    get ready(): boolean {
        return this.mounted;
    }

    async mount(container: HTMLElement): Promise<void> {
        this.dispose();
        this.container = container;
        const mod = await import('@coderline/alphatab');
        this.mod = mod;

        const settings = new mod.Settings();
        settings.core.useWorkers = false; // 主线程渲染，绕开 worker 打包/通信与懒加载问题
        settings.core.enableLazyLoading = false; // 禁用懒加载，立即渲染全部内容
        settings.core.fontDirectory = new URL('font/', document.baseURI).href; // 字体放 public/font，dev/web/扩展通用
        settings.core.includeNoteBounds = true; // 收集音符边界，供点击命中
        settings.display.scale = ALPHATAB_DISPLAY_SCALE; // 整体缩放（含字体），适配紧凑布局
        // 纯六线谱模式：alphaTab 才会在六线上画休止符与拍号（见 applyDisplaySettings）
        this.applyDisplaySettings(settings, mod, this.displayMode);
        settings.player.playerMode = mod.PlayerMode.Disabled;

        // 深色主题适配：浅色音符/文字/谱线，让 alphaTab 内容在深色背景上可见
        const res = settings.display.resources;
        res.mainGlyphColor = new mod.model.Color(235, 235, 235);       // 音符主色
        res.secondaryGlyphColor = new mod.model.Color(200, 200, 200, 0.6); // 次声部
        res.scoreInfoColor = new mod.model.Color(210, 210, 210);       // 标题/信息
        res.staffLineColor = new mod.model.Color(150, 150, 150);       // 五线谱线
        res.barSeparatorColor = new mod.model.Color(170, 170, 170);    // 小节线
        res.barNumberColor = new mod.model.Color(230, 170, 90);        // 小节号（贴合主题橙）

        this.api = new mod.AlphaTabApi(container, settings);
        this.mounted = true;

        // 渲染完成时缓存 boundsLookup（供点击命中/选中高亮重算）
        this.unsubscribeRenderFinished = this.api.renderFinished.on(() => {
            this.boundsLookup = this.api?.renderer.boundsLookup ?? null;
            this.applySelectionHighlight();
            this.applyEditCursor();
        });
        container.addEventListener('click', this.onClickBound);

        // 调试钩子（仅 dev）：headless 坐标验证用
        if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__tabForgeAlphaTabDebug = {
                hitTest: (clientX: number, clientY: number) =>
                    this.onContainerClick({ clientX, clientY } as MouseEvent),
                hitTestCell: (clientX: number, clientY: number) =>
                    this.hitTestTabCell(clientX, clientY),
                getBounds: () => this.boundsLookup,
            };
        }
    }

    /** 容器点击 → 命中拍/音符 + 六线谱单元 → 交给 scoreEditing */
    private onContainerClick(e: MouseEvent): void {
        if (!this.api || !this.boundsLookup || !this.container) return;
        const local = this.toLocal(e.clientX, e.clientY);
        if (!local) return;
        const beat = this.boundsLookup.getBeatAtPos(local.x, local.y);
        const note = beat ? this.boundsLookup.getNoteAtPos(beat, local.x, local.y) : null;
        const cell = this.hitTestTabCell(e.clientX, e.clientY);
        handleScoreClick({ beat, note, cell });
    }

    /** 渲染当前谱面（load 后由 alphaTab 异步渲染） */
    render(score: TabScore): void {
        if (!this.api || !this.mod) return;
        this.score = score;
        if (score.measures.length === 0) {
            // 空谱（如清空）：隐藏 alphaTab 面（不 remove，避免脱离 DOM 导致后续白屏），显示空状态
            if (!this.emptyStateEl || !this.container?.contains(this.emptyStateEl)) {
                this.container?.querySelectorAll<HTMLElement>('.at-surface').forEach(el => { el.style.display = 'none'; });
                this.emptyStateEl = document.createElement('div');
                this.emptyStateEl.className = 'empty-state';
                this.fillEmptyState();
                this.container?.appendChild(this.emptyStateEl);
            }
            return;
        }
        this.emptyStateEl?.remove();
        this.emptyStateEl = null;
        this.container?.querySelectorAll<HTMLElement>('.at-surface').forEach(el => { el.style.display = ''; });
        const atScore = tabScoreToAlphaTabScore(score);
        this.api.load(atScore);
    }

    /** 空状态文案（只在空谱时构建；语言切换由 refreshEmptyState 就地更新） */
    private fillEmptyState(): void {
        if (!this.emptyStateEl) return;
        this.emptyStateEl.textContent = '';
        this.emptyStateEl.append(t('empty.title'), document.createElement('br'));
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = t('empty.hint');
        this.emptyStateEl.appendChild(hint);
    }

    /** 语言切换后就地刷新空谱提示（非空谱时无操作） */
    refreshEmptyState(): void {
        this.fillEmptyState();
    }

    dispose(): void {
        this.unsubscribeRenderFinished?.();
        this.unsubscribeRenderFinished = null;
        this.container?.removeEventListener('click', this.onClickBound);
        this.boundsLookup = null;
        this.emptyStateEl?.remove();
        this.emptyStateEl = null;
        this.api?.destroy();
        this.api = null;
        this.mod = null;
        this.mounted = false;
        this.highlightEl = null;
        this.editCellEl = null;
        this.editRowEl = null;
        this.editCursor = null;
        this.score = null;
        this.selectedMeasure = -1;
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}
