/**
 * renderer — pdfjs 页面 → 位图（OCR 用）
 *
 * 复用 pdfLoader 的 pdfjs 单例；不做 devicePixelRatio 缩放，
 * 保证 1 canvas px = 1 ImageData px = 1 viewport 输入单位。
 */

import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { getPdfJs } from '../pdfLoader.ts';
import { OCR_IMPORT_CONFIG } from './ocrConfig.ts';

/** 渲染后的页面位图 */
export interface RenderedPage {
    pageIndex: number;
    canvas: HTMLCanvasElement;
    imageData: ImageData;
    viewport: PageViewport;
}

/** 计算渲染缩放：按目标页宽像素（保持 DPI 足够供 OCR 识别） */
export function renderScaleFor(pageWidth: number): number {
    const { renderScaleTarget, renderScaleMin, renderScaleMax } = OCR_IMPORT_CONFIG;
    const s = renderScaleTarget / pageWidth;
    return Math.max(renderScaleMin, Math.min(renderScaleMax, s));
}

/** 渲染页面为 canvas + ImageData */
export async function renderPage(page: PDFPageProxy, scale: number): Promise<RenderedPage> {
    await getPdfJs(); // 确保 pdfjs 已就绪（worker 配置）
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 画布上下文');
    await page.render({ canvas, viewport }).promise;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { pageIndex: page.pageNumber - 1, canvas, imageData, viewport };
}
