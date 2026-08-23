/**
 * alphaTabRenderer — alphaTab 专业谱面渲染（懒加载）
 *
 * 用 AlphaTabApi 把 TabScore 渲染成六线谱/五线谱，与自研 Canvas 渲染器互为备选。
 * - 主线程渲染（useWorkers=false）：绕开 worker 打包/通信与懒加载占位问题
 * - 播放走独立引擎（audioEngine / alphaTabPlayer），这里禁用 alphaTab 自带播放器
 * - mount 是异步（动态 import alphaTab）
 */

import type { TabScore } from '../types/index.ts';
import { tabScoreToAlphaTabScore } from './scoreAdapter.ts';
import { handleScoreClick } from './scoreEditing.ts';

type AlphaTabModule = typeof import('@coderline/alphatab');
type AlphaTabBeat = import('@coderline/alphatab').model.Beat;
type AlphaTabNote = import('@coderline/alphatab').model.Note;

/** boundsLookup 的子集（model.BoundsLookup 未在类型里导出，用结构类型） */
interface BoundsLookupLike {
    getBeatAtPos(x: number, y: number): AlphaTabBeat | null;
    getNoteAtPos(beat: AlphaTabBeat, x: number, y: number): AlphaTabNote | null;
}

export class AlphaTabRenderer {
    private api: import('@coderline/alphatab').AlphaTabApi | null = null;
    private mod: AlphaTabModule | null = null;
    private container: HTMLElement | null = null;
    private mounted = false;
    private boundsLookup: BoundsLookupLike | null = null;
    private unsubscribeRenderFinished: (() => void) | null = null;
    private emptyStateEl: HTMLElement | null = null;
    private readonly onClickBound = (e: MouseEvent): void => this.onContainerClick(e);

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

        // 渲染完成时缓存 boundsLookup（供点击命中）
        this.unsubscribeRenderFinished = this.api.renderFinished.on(() => {
            this.boundsLookup = this.api?.renderer.boundsLookup ?? null;
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
            // 空谱：不加载 alphaTab（避免渲染占位/报错），显示空状态提示
            if (!this.emptyStateEl || !this.container?.contains(this.emptyStateEl)) {
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
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}
