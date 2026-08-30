/**
 * pdfLoader — pdfjs IO 层（本模块是唯一接触 pdfjs 的文件）
 *
 * - pdfjs 懒加载（同 alphaTab 模式，主包不膨胀），worker 用 `?url` 静态资产挂同源路径。
 *   MV3 CSP `script-src 'self'` 允许同源 module worker；worker 创建失败时 pdfjs 自动
 *   回退 fake worker（主线程动态 import），解析不硬失败。绝不用 CDN / blob: URL。
 * - 只输出纯几何数据（tabGeometry），不解析业务语义；解析逻辑在 parsePdf.ts（可单测）。
 */

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { LineSegment, PageGeometry, PlainTextItem } from './tabGeometry.ts';
import { PDF_IMPORT_CONFIG } from '../config.ts';

/** pdfjs 算子列表的局部结构类型（PDFOperatorList 未从 pdfjs-dist 根导出） */
interface PdfOperatorListLike {
    fnArray: number[];
    argsArray: any[];
}

/** pdfjs 文本项的局部结构类型（TextItem 未从 pdfjs-dist 根导出） */
interface PdfTextItemLike {
    str: string;
    transform: number[];
    width: number;
    height: number;
}

/** pdfjs 懒加载单例（设置一次 workerSrc） */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function getPdfJs(): Promise<typeof import('pdfjs-dist')> {
    if (!pdfjsPromise) {
        pdfjsPromise = import('pdfjs-dist').then((m) => {
            m.GlobalWorkerOptions.workerSrc = workerUrl;
            return m;
        });
    }
    return pdfjsPromise;
}

/**
 * 把 PDF 提取为逐页几何（文本项 + 线段），供纯函数 parseTabGeometry 解析。
 */
export async function extractGeometry(arrayBuffer: ArrayBuffer): Promise<PageGeometry[]> {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const doc: PDFDocumentProxy = await loadingTask.promise;
    try {
        const pages: PageGeometry[] = [];
        for (let p = 1; p <= doc.numPages; p++) {
            const page: PDFPageProxy = await doc.getPage(p);
            const [text, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
            const items: PlainTextItem[] = [];
            for (const it of text.items) {
                if ('str' in it) items.push(toPlainTextItem(it));
            }
            pages.push({
                pageIndex: p - 1,
                items,
                segments: walkOperatorList(ops, pdfjs),
            });
        }
        return pages;
    } finally {
        await doc.destroy();
    }
}

/** TextItem → PlainTextItem（transform: [a,b,c,d,e,f]，e/f 为位置，|d| 为字高） */
function toPlainTextItem(it: PdfTextItemLike): PlainTextItem {
    const t = it.transform;
    const fontHeight = Math.abs(t[3]) || it.height || 10;
    const width = it.width && it.width > 0
        ? it.width
        : it.str.length * fontHeight * 0.5; // 兜底：数字 ~0.5em 宽
    return { str: it.str, x: t[4], y: t[5], fontHeight, width };
}

/**
 * 走算子流提取水平谱线/垂直小节线段（PDF 用户空间）。
 * 处理 q/Q(cm) 变换、re 矩形、m/l 路径 + stroke/fill；忽略曲线与样式设置。
 */
function walkOperatorList(
    ops: PdfOperatorListLike,
    pdfjs: typeof import('pdfjs-dist'),
): LineSegment[] {
    const O = pdfjs.OPS;
    const out: LineSegment[] = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    let path: [number, number][] = [];

    /** 应用当前 CTM 变换坐标点 */
    const xp = (p: [number, number]): [number, number] => [
        ctm[0] * p[0] + ctm[2] * p[1] + ctm[4],
        ctm[1] * p[0] + ctm[3] * p[1] + ctm[5],
    ];

    /** 薄矩形 → 水平/垂直线段（用户空间） */
    const pushRectAsLine = (x: number, y: number, w: number, h: number): void => {
        const p0 = xp([x, y]);
        const p1 = xp([x + w, y + h]);
        const cx = (p0[0] + p1[0]) / 2;
        const cy = (p0[1] + p1[1]) / 2;
        const bw = Math.abs(p1[0] - p0[0]);
        const bh = Math.abs(p1[1] - p0[1]);
        if (bw >= PDF_IMPORT_CONFIG.minLineLen && bh <= Math.max(bw * 0.1, 2)) {
            out.push({ x1: Math.min(p0[0], p1[0]), y1: cy, x2: Math.max(p0[0], p1[0]), y2: cy });
        } else if (bh >= PDF_IMPORT_CONFIG.minLineLen && bw <= Math.max(bh * 0.1, 2)) {
            out.push({ x1: cx, y1: Math.min(p0[1], p1[1]), x2: cx, y2: Math.max(p0[1], p1[1]) });
        }
    };

    /** 提交当前路径的相邻段 */
    const flushPath = (): void => {
        for (let j = 1; j < path.length; j++) {
            const a = path[j - 1];
            const b = path[j];
            out.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
        }
        path = [];
    };

    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];
        switch (fn) {
            case O.save:
                stack.push(ctm);
                ctm = [...ctm];
                break;
            case O.restore:
                ctm = stack.pop() ?? ctm;
                break;
            case O.transform: {
                // pdfjs 算子参数是扁平数组：cm 的 args 即 [a,b,c,d,e,f]
                const [a, b, c, d, e, f] = args as number[];
                const [a0, b0, c0, d0, e0, f0] = ctm;
                ctm = [
                    a * a0 + c * b0,
                    b * a0 + d * b0,
                    a * c0 + c * d0,
                    b * c0 + d * d0,
                    a * e0 + c * f0 + e,
                    b * e0 + d * f0 + f,
                ];
                break;
            }
            case O.rectangle: {
                const [x, y, w, h] = args as [number, number, number, number];
                pushRectAsLine(x, y, w, h);
                break;
            }
            case O.moveTo:
                path = [xp(args as [number, number])];
                break;
            case O.lineTo:
                path.push(xp(args as [number, number]));
                break;
            case O.constructPath: {
                const [opCodes, opArgs] = args as [number[], Array<number[] | number>];
                for (let j = 0; j < opCodes.length; j++) {
                    const op = opCodes[j];
                    if (op === O.moveTo) {
                        path = [xp(opArgs[j] as [number, number])];
                    } else if (op === O.lineTo) {
                        path.push(xp(opArgs[j] as [number, number]));
                    } else if (op === O.rectangle) {
                        const [x, y, w, h] = opArgs[j] as number[];
                        pushRectAsLine(x, y, w, h);
                    } else if (op === O.closePath) {
                        path = [];
                    }
                }
                break;
            }
            case O.closeStroke:
                flushPath();
                break;
            case O.stroke:
            case O.fill:
            case O.eoFill:
            case O.fillStroke:
            case O.eoFillStroke:
                flushPath();
                break;
            case O.closePath:
                path = [];
                break;
            default:
                break;
        }
    }
    return out;
}
