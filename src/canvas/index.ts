/**
 * 渲染器模块入口
 *
 * 职责：导出 TabCanvasRenderer 类和工厂函数 createTabCanvas。
 * 不包含任何具体渲染逻辑，只做模块整合。
 *
 * 子模块说明：
 *
 * draw/                    ← 公共绘制方法层（怎么画）
 *   arc.ts                  弧线绘制
 *   circle.ts               圆圈绘制（符头）
 *   text.ts                 文本绘制
 *
 * techniques/              ← 功能模块层（画什么）
 *   measureRenderer.ts      小节渲染编排（指挥模块）
 *   singleNote.ts           单音（符头+数字）
 *   chord.ts                和弦多音
 *   rest.ts                 休止符
 *   barline.ts              小节线
 *   longNoteBar.ts          长时值粗横线（全/二分音符）
 *   slur.ts                 连音乐句（弧线：击弦H/勾弦P/滑弦S/延音tie）
 *   rhythm.ts               时值指示（符干/符尾/beam）
 *   rowDecorations.ts       行装饰（弦标签、六线、小节编号）
 *   infoBar.ts              顶部信息栏 + 空状态
 *
 * constants.ts             颜色和布局常量
 * types.ts                 内部辅助类型
 * duration.ts              时值工具函数
 * layout.ts                布局和换行算法
 */

import type { TabScore } from '../types/index.ts';
import { COLORS, LAYOUT } from './constants.ts';
import { layoutRows } from './layout.ts';
import { renderTabRow, getRowTopY, getStringY, getContentBounds } from './techniques/measureRenderer.ts';
import { renderEmptyState, renderInfoBar } from './techniques/infoBar.ts';
import { renderStrings, renderMeasureNumbers } from './techniques/rowDecorations.ts';
import { renderRhythm } from './techniques/rhythm.ts';


// ============================================================
// Canvas 渲染器类
// ============================================================

export class TabCanvasRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private width: number = 0;
    private height: number = 0;
    private dpr: number = 1;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.dpr = window.devicePixelRatio || 1;
    }

    /** 设置尺寸（CSS 像素）并适配 HiDPI */
    setSize(width: number, height: number): void {
        if (this.width === width && this.height === height) return;
        this.width = width;
        this.height = height;
        this.canvas.width = width * this.dpr;
        this.canvas.height = height * this.dpr;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    /** 获取 Canvas 宽度 */
    getWidth(): number {
        return this.width;
    }

    /** 清空画布 */
    clear(): void {
        this.ctx.fillStyle = COLORS.bg;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    // ============================================================
    // 主渲染入口
    // ============================================================

    render(score: TabScore): void {
        this.clear();

        const { measures, tuning, bpm, title, artist } = score;

        if (measures.length === 0) {
            renderEmptyState(this.ctx, this.width, this.height);
            return;
        }

        // 顶部信息栏
        renderInfoBar(this.ctx, title, artist, tuning, bpm);

        // 布局
        const rows = layoutRows(measures, this.width);

        // 根据行数动态调整画布高度，确保换行后所有行可见
        const rowTotalHeight = 6 * LAYOUT.lineSpacing + LAYOUT.rowGap;
        const neededHeight = LAYOUT.paddingTop + rows.length * rowTotalHeight + LAYOUT.paddingBottom;
        if (neededHeight !== this.height) {
            this.height = neededHeight;
            this.canvas.height = neededHeight * this.dpr;
            this.canvas.style.height = neededHeight + 'px';
        }

        // 渲染每一行
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
            const row = rows[rowIdx];
            const rowTopY = getRowTopY(rowIdx);
            const bounds = getContentBounds(this.width);

            // 弦标签 + 六线
            renderStrings(this.ctx, rowTopY, bounds.left, bounds.right, LAYOUT.paddingLeft + LAYOUT.stringLabelWidth);

            // 时值指示器
            const string6Y = getStringY(rowTopY, 6);
            renderRhythm(this.ctx, row.notePositions, string6Y);

            // 音符/小节线/技法（核心渲染）
            renderTabRow(this.ctx, row, rowIdx, this.width);

            // 行底小节编号
            renderMeasureNumbers(this.ctx, row.notePositions, rowTopY);
        }
    }

    /** 高亮某一小节（播放时） */
    highlightMeasure(_measureIndex: number): void {
        // 预留接口
    }

    /** 销毁释放 */
    dispose(): void {
        this.clear();
    }
}

/**
 * 创建 Canvas 元素并挂载到容器
 */
export function createTabCanvas(container: HTMLElement, width: number, height: number): TabCanvasRenderer {
    container.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    container.appendChild(canvas);

    const renderer = new TabCanvasRenderer(canvas);
    renderer.setSize(width, height);

    return renderer;
}

