/**
 * staffDetector 纯函数单测 — 合成 ImageData fixture，不碰 pdfjs/tesseract。
 *
 * fixture 约定：用户页面 500×700，渲染 scale=2 → 画布 1000×1400。
 * 6 条谱线在用户 y=100..150（间距 10），x 50..450；
 * 小节线在用户 x=150/350。像素坐标 y 向下（pdfjs viewport 语义）。
 */

import { describe, it, expect } from 'vitest';
import { detectStaffLines, cropRectFor, type PixelToUserMapper } from './staffDetector.ts';
import { OCR_IMPORT_CONFIG } from './ocrConfig.ts';

const S = 2;
const USER_H = 700;

/** 与 pdfjs PageViewport 同构的最小坐标映射器（scale=2，y 翻转） */
function makeMapper(): PixelToUserMapper {
    return {
        convertToPdfPoint: (px: number, py: number) => [px / S, USER_H - py / S],
        convertToViewportPoint: (ux: number, uy: number) => [ux * S, (USER_H - uy) * S],
    };
}

/** 白底画布 */
function makeImage(width: number, height: number): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
    }
    return { width, height, data } as unknown as ImageData;
}

/** 画黑色矩形 */
function darken(img: ImageData, x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const i = (y * img.width + x) * 4;
            img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0;
        }
    }
}

/** 标准 fixture：1 个六线谱（y=100..150）+ 2 根小节线（x=150/350） */
function makeStaffFixture(): ImageData {
    const img = makeImage(1000, 1400);
    // 6 条谱线：用户 y=150..100 → 像素行 1100,1120,...,1200，各 2px 厚，x 列 100..899
    const linePx: number[] = [1100, 1120, 1140, 1160, 1180, 1200];
    for (const r of linePx) darken(img, 100, r, 899, r + 1);
    // 2 根小节线：用户 x=150/350 → 像素列 300/700，各 2px 宽，跨谱表高（像素行 1080..1220）
    darken(img, 300, 1080, 301, 1220);
    darken(img, 700, 1080, 701, 1220);
    return img;
}

describe('detectStaffLines', () => {
    it('检测到六线谱谱表（用户空间坐标）', () => {
        const res = detectStaffLines(makeStaffFixture(), makeMapper(), OCR_IMPORT_CONFIG);
        expect(res.staffs).toHaveLength(1);
        const ys = res.staffs[0].lineYs;
        expect(ys).toHaveLength(6);
        // 期望 ≈ [100,110,...,150]（容差 1.5）
        for (let i = 0; i < 6; i++) {
            expect(Math.abs(ys[i] - (100 + i * 10))).toBeLessThan(1.5);
        }
        expect(Math.abs(res.staffs[0].xStart - 50)).toBeLessThan(1);
        expect(Math.abs(res.staffs[0].xEnd - 450)).toBeLessThan(1);
        // 原始 hLines 至少 6 条（每条谱线一带）
        expect(res.hLines.length).toBeGreaterThanOrEqual(6);
    });

    it('检测到小节线（用户空间 x≈150/350）', () => {
        const res = detectStaffLines(makeStaffFixture(), makeMapper(), OCR_IMPORT_CONFIG);
        expect(res.vLines.length).toBe(2);
        const xs = res.vLines.map(v => v.x).sort((a, b) => a - b);
        expect(Math.abs(xs[0] - 150)).toBeLessThan(2);
        expect(Math.abs(xs[1] - 350)).toBeLessThan(2);
        // VLine 高度覆盖谱表上下沿
        for (const v of res.vLines) {
            expect(v.y2 - v.y1).toBeGreaterThan(60);
        }
    });

    it('cropRectFor 由谱表换算像素裁剪区', () => {
        const res = detectStaffLines(makeStaffFixture(), makeMapper(), OCR_IMPORT_CONFIG);
        const margin = OCR_IMPORT_CONFIG.cropMarginUser;
        const crop = cropRectFor(res.staffs[0], makeMapper(), margin);
        // left = viewport(xStart-margin), top = viewport(staff.top+margin)，随配置变化
        expect(crop.x).toBe(Math.floor((50 - margin) * 2));
        expect(crop.y).toBe(Math.floor((700 - (159.75 + margin)) * 2));
        expect(crop.w).toBeGreaterThan(0);
        expect(crop.h).toBeGreaterThan(0);
    });

    it('空白页不产生谱表', () => {
        const res = detectStaffLines(makeImage(1000, 1400), makeMapper(), OCR_IMPORT_CONFIG);
        expect(res.staffs).toHaveLength(0);
        expect(res.hLines).toHaveLength(0);
    });

    it('仅 5 条线不算谱表（标准记谱不被误检）', () => {
        const img = makeImage(1000, 1400);
        for (const r of [1100, 1120, 1140, 1160, 1180]) darken(img, 100, r, 899, r + 1);
        const res = detectStaffLines(img, makeMapper(), OCR_IMPORT_CONFIG);
        expect(res.staffs).toHaveLength(0);
    });
});
