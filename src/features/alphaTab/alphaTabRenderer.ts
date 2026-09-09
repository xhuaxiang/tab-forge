/**
 * alphaTabRenderer — alphaTab 专业谱面渲染（懒加载）
 *
 * 用 AlphaTabApi 把 TabScore 渲染成六线谱/五线谱，与自研 Canvas 渲染器互为备选。
 * - 主线程渲染（useWorkers=false）：绕开 worker 打包/通信与懒加载占位问题
 * - 播放走独立引擎（audioEngine / alphaTabPlayer），这里禁用 alphaTab 自带播放器
 * - mount 是异步（动态 import alphaTab）
 */

import type { TabScore } from '../../core/types/index.ts';
import { tabScoreToAlphaTabScore } from './scoreAdapter.ts';
import { handleScoreClick } from './scoreEditing.ts';

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

/** 行(StaffSystem)内的 MasterBar bounds：index 即全局小节号（单轨），realBounds 覆盖整小节含空白 */
interface StaffSystemLike {
    bars: Array<{ index: number; realBounds: SimpleBounds }>;
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
    /** 当前选中的小节号（-1 = 无）；由 scoreStore.selectMeasure → state 调用 setSelectedMeasure 维护 */
    private selectedMeasure = -1;
    private readonly onClickBound = (e: MouseEvent): void => this.onContainerClick(e);

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

        // alphaTab bounds 坐标以 .at-surface 左上角为原点；换算成相对容器的坐标
        const surface = this.container.querySelector('.at-surface') as HTMLElement | null;
        const base = surface ?? this.container;
        const baseRect = base.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        const offX = baseRect.left - containerRect.left;
        const offY = baseRect.top - containerRect.top;

        const pad = 3;
        const el = this.ensureHighlightEl();
        el.style.left = `${minX + offX - pad}px`;
        el.style.top = `${minY + offY - pad}px`;
        el.style.width = `${maxX - minX + pad * 2}px`;
        el.style.height = `${maxY - minY + pad * 2}px`;
        el.style.display = 'block';
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
        settings.display.scale = 0.75; // 整体缩放（含字体），适配紧凑布局
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
        });
        container.addEventListener('click', this.onClickBound);

        // 调试钩子（仅 dev）：headless 坐标验证用
        if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__tabForgeAlphaTabDebug = {
                hitTest: (clientX: number, clientY: number) =>
                    this.onContainerClick({ clientX, clientY } as MouseEvent),
                getBounds: () => this.boundsLookup,
            };
        }
    }

    /** 容器点击 → 命中拍/音符 → 交给 scoreEditing */
    private onContainerClick(e: MouseEvent): void {
        if (!this.api || !this.boundsLookup || !this.container) return;
        const surface = this.container.querySelector('.at-surface') as HTMLElement | null;
        const el = surface ?? this.container;
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left; // 与 alphaTab 内部坐标一致
        const y = e.clientY - rect.top;
        const beat = this.boundsLookup.getBeatAtPos(x, y);
        const note = beat ? this.boundsLookup.getNoteAtPos(beat, x, y) : null;
        handleScoreClick({ beat, note });
    }

    /** 渲染当前谱面（load 后由 alphaTab 异步渲染） */
    render(score: TabScore): void {
        if (!this.api || !this.mod) return;
        if (score.measures.length === 0) {
            // 空谱（如清空）：隐藏 alphaTab 面（不 remove，避免脱离 DOM 导致后续白屏），显示空状态
            if (!this.emptyStateEl || !this.container?.contains(this.emptyStateEl)) {
                this.container?.querySelectorAll<HTMLElement>('.at-surface').forEach(el => { el.style.display = 'none'; });
                this.emptyStateEl = document.createElement('div');
                this.emptyStateEl.className = 'empty-state';
                this.emptyStateEl.innerHTML = '点击「+ 小节」开始创建吉他六线谱<br>'
                    + '<span class="hint">提示：数字 = 品位，0 = 空弦，- = 不弹</span>';
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
        this.selectedMeasure = -1;
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}
