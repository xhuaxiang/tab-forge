/**
 * staffDetector — 像素级谱表/小节线检测（纯函数，可单测，不碰 pdfjs/tesseract）
 *
 * 输入渲染位图 ImageData + 最小坐标映射器（pdfjs PageViewport 结构兼容），
 * 输出 PDF 用户空间的 HLine/VLine/Staff，供 OCR 裁剪与现有装配复用。
 */

import { detectStaffs, mergeHLines, type HLine, type VLine } from '../parsePdf.ts';
import type { Staff } from '../tabGeometry.ts';
import type { OCR_IMPORT_CONFIG } from './ocrConfig.ts';

/** 像素 ↔ PDF 用户空间映射的最小接口（pdfjs PageViewport 结构兼容） */
export interface PixelToUserMapper {
    convertToPdfPoint(x: number, y: number): number[];
    convertToViewportPoint(x: number, y: number): number[];
}

export interface StaffDetectorResult {
    hLines: HLine[];
    vLines: VLine[];
    staffs: Staff[];
}

/** 页面像素裁剪矩形（由谱表用户空间矩形换算） */
export interface OcrCropRect { x: number; y: number; w: number; h: number }

type OcrCfg = typeof OCR_IMPORT_CONFIG;

/** 谱表（用户空间）→ 页面像素裁剪矩形（含外扩 marginUser） */
export function cropRectFor(staff: Staff, viewport: PixelToUserMapper, marginUser: number): OcrCropRect {
    const midY = (staff.top + staff.bottom) / 2;
    const left = viewport.convertToViewportPoint(staff.xStart - marginUser, midY)[0];
    const right = viewport.convertToViewportPoint(staff.xEnd + marginUser, midY)[0];
    const top = viewport.convertToViewportPoint(midY, staff.top + marginUser)[1];
    const bottom = viewport.convertToViewportPoint(midY, staff.bottom - marginUser)[1];
    const x = Math.max(0, Math.floor(Math.min(left, right)));
    const y = Math.max(0, Math.floor(Math.min(top, bottom)));
    const w = Math.max(1, Math.ceil(Math.max(left, right)) - x);
    const h = Math.max(1, Math.ceil(Math.max(top, bottom)) - y);
    return { x, y, w, h };
}

/** 亮度（0-255） */
function luma(r: number, g: number, b: number): number {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 检测六线谱谱表与小节线。
 * 1) 单遍统计每行暗像素数与暗 x 范围；
 * 2) 暗行聚成水平谱线带 → HLine（用户空间）；
 * 3) 复用 detectStaffs 找 6 等距线谱表；
 * 4) 每谱表内垂直暗列聚成小节线带 → VLine（用户空间）。
 */
export function detectStaffLines(
    imageData: ImageData,
    viewport: PixelToUserMapper,
    cfg: OcrCfg,
): StaffDetectorResult {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;

    const rowDark = new Int32Array(h);
    const rowMinX = new Int32Array(h);
    const rowMaxX = new Int32Array(h);
    rowMinX.fill(w);
    rowMaxX.fill(-1);

    for (let y = 0; y < h; y++) {
        const off = y * w;
        for (let x = 0; x < w; x++) {
            const i = (off + x) * 4;
            if (luma(data[i], data[i + 1], data[i + 2]) < cfg.darkLumaThreshold) {
                rowDark[y]++;
                if (x < rowMinX[y]) rowMinX[y] = x;
                if (x > rowMaxX[y]) rowMaxX[y] = x;
            }
        }
    }

    // 水平谱线带 → HLine（用户空间）
    const hLines: HLine[] = [];
    let y = 0;
    while (y < h) {
        if (rowDark[y] / w < cfg.lineRatioThreshold) { y++; continue; }
        let yEnd = y;
        while (yEnd < h && rowDark[yEnd] / w >= cfg.lineRatioThreshold) yEnd++;
        const thickness = yEnd - y;
        const [tMin, tMax] = cfg.lineBandThicknessPx;
        if (thickness >= tMin && thickness <= tMax) {
            let sum = 0, cnt = 0, minX = w, maxX = -1;
            for (let yy = y; yy < yEnd; yy++) {
                sum += rowDark[yy] * yy;
                cnt += rowDark[yy];
                if (rowMinX[yy] < minX) minX = rowMinX[yy];
                if (rowMaxX[yy] > maxX) maxX = rowMaxX[yy];
            }
            const bandY = sum / cnt;
            const [, yu] = viewport.convertToPdfPoint((minX + maxX) / 2, bandY);
            const x1u = viewport.convertToPdfPoint(minX, bandY)[0];
            const x2u = viewport.convertToPdfPoint(maxX, bandY)[0];
            hLines.push({ y: yu, x1: Math.min(x1u, x2u), x2: Math.max(x1u, x2u) });
        }
        y = yEnd;
    }

    // 谱表：6 等距长线（标准记谱是 5 线，detectStaffs 靠数量+等距区分）
    const staffs = detectStaffs(mergeHLines(hLines));

    // 每谱表垂直小节线带 → VLine（用户空间）
    const vLines: VLine[] = [];
    for (const staff of staffs) {
        const midX = (staff.xStart + staff.xEnd) / 2;
        const midY = (staff.top + staff.bottom) / 2;
        const [x0P] = viewport.convertToViewportPoint(staff.xStart, midY);
        const [x1P] = viewport.convertToViewportPoint(staff.xEnd, midY);
        const [, topP] = viewport.convertToViewportPoint(midX, staff.top);
        const [, botP] = viewport.convertToViewportPoint(midX, staff.bottom);
        const x0 = Math.max(0, Math.floor(Math.min(x0P, x1P)));
        const x1 = Math.min(w - 1, Math.ceil(Math.max(x0P, x1P)));
        const yTop = Math.max(0, Math.floor(Math.min(topP, botP)));
        const yBot = Math.min(h - 1, Math.ceil(Math.max(topP, botP)));
        const colH = Math.max(1, yBot - yTop + 1);

        const colDark = (cx: number): number => {
            let dark = 0;
            for (let yy = yTop; yy <= yBot; yy++) {
                const i = (yy * w + cx) * 4;
                if (luma(data[i], data[i + 1], data[i + 2]) < cfg.darkLumaThreshold) dark++;
            }
            return dark;
        };

        let x = x0;
        while (x <= x1) {
            if (colDark(x) / colH < cfg.barlineRatioThreshold) { x++; continue; }
            let xEnd = x;
            while (xEnd <= x1 && colDark(xEnd) / colH >= cfg.barlineRatioThreshold) xEnd++;
            const xc = (x + xEnd - 1) / 2;
            const xu = viewport.convertToPdfPoint(xc, midY)[0];
            const y1u = viewport.convertToPdfPoint(xc, yBot)[1];
            const y2u = viewport.convertToPdfPoint(xc, yTop)[1];
            if (Math.abs(y2u - y1u) >= cfg.barlineMinHeightUser) {
                vLines.push({ x: xu, y1: Math.min(y1u, y2u), y2: Math.max(y1u, y2u) });
            }
            x = xEnd;
        }
    }

    return { hLines, vLines, staffs };
}
