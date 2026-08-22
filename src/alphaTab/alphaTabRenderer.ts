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

type AlphaTabModule = typeof import('@coderline/alphatab');

export class AlphaTabRenderer {
    private api: import('@coderline/alphatab').AlphaTabApi | null = null;
    private mod: AlphaTabModule | null = null;
    private container: HTMLElement | null = null;
    private mounted = false;

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
    }

    /** 渲染当前谱面（load 后由 alphaTab 异步渲染） */
    render(score: TabScore): void {
        if (!this.api || !this.mod) return;
        const atScore = tabScoreToAlphaTabScore(score);
        console.log(atScore)
        this.api.load(atScore);
    }

    dispose(): void {
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
