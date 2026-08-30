/**
 * parsePdfOcr — OCR 回退编排
 *
 * 渲染每页 → 像素级谱表/小节检测 → 每谱表裁剪数字 OCR →
 * 产出 PageGeometry 喂回现有 parseTabGeometry（复用 弦号/两位数合并/和弦/时值/小节 装配）。
 */

import type { TabScore } from '../../types/index.ts';
import type { LineSegment, PageGeometry, PlainTextItem } from '../tabGeometry.ts';
import { parseTabGeometry } from '../parsePdf.ts';
import { getPdfJs } from '../pdfLoader.ts';
import { renderPage, renderScaleFor } from './renderer.ts';
import { detectStaffLines, cropRectFor } from './staffDetector.ts';
import { ocrStaffCrop } from './digitOcr.ts';
import { OCR_IMPORT_CONFIG } from './ocrConfig.ts';

/**
 * 解析扫描/图片 PDF → TabScore。
 * @param onProgress 可选进度回调（状态消息）
 */
export async function parsePdfOcr(
    arrayBuffer: ArrayBuffer,
    onProgress?: (msg: string) => void,
): Promise<TabScore> {
    const pdfjs = await getPdfJs();
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    try {
        const pages: PageGeometry[] = [];
        for (let p = 1; p <= doc.numPages; p++) {
            onProgress?.(`渲染/检测第 ${p}/${doc.numPages} 页...`);
            const page = await doc.getPage(p);
            const scale = renderScaleFor(page.getViewport({ scale: 1 }).width);
            const { canvas, imageData, viewport } = await renderPage(page, scale);
            const { hLines, vLines, staffs } = detectStaffLines(imageData, viewport, OCR_IMPORT_CONFIG);

            const items: PlainTextItem[] = [];
            for (let s = 0; s < staffs.length; s++) {
                onProgress?.(`OCR 识别第 ${p} 页第 ${s + 1}/${staffs.length} 个谱表...`);
                const crop = cropRectFor(staffs[s], viewport, OCR_IMPORT_CONFIG.cropMarginUser);
                items.push(...await ocrStaffCrop(canvas, crop, viewport, onProgress));
            }

            const segments: LineSegment[] = [
                ...hLines.map(l => ({ x1: l.x1, y1: l.y, x2: l.x2, y2: l.y })),
                ...vLines.map(l => ({ x1: l.x, y1: l.y1, x2: l.x, y2: l.y2 })),
            ];
            pages.push({ pageIndex: p - 1, items, segments });
        }
        return parseTabGeometry(pages);
    } finally {
        await doc.destroy();
    }
}
