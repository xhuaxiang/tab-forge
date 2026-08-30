/**
 * digitOcr — Tesseract.js 懒加载 + 每谱表裁剪识别品数数字
 *
 * - worker/core/traineddata 全部同源本地（?url / public/tessdata），
 *   workerBlobURL:false（MV3 禁 blob worker）。
 * - LSTM 引擎忽略 tessedit_char_whitelist → 依赖后置过滤（regex + 置信度 + 高度）。
 * - 输出 PDF 用户空间的 PlainTextItem[]（基线按 textBaselineToCenter 构造，
 *   使 parsePdf.mapNotes 反推出原字形中心），喂回现有装配逻辑。
 */

import coreUrl from 'tesseract.js-core/tesseract-core-simd.wasm.js?url'; // legacy（非 LSTM）内核，配合 whitelist 识别数字更准
import type * as Tesseract from 'tesseract.js';
import type { PlainTextItem } from '../tabGeometry.ts';
import { PDF_IMPORT_CONFIG } from '../../config.ts';
import { OCR_IMPORT_CONFIG } from './ocrConfig.ts';
import type { PixelToUserMapper } from './staffDetector.ts';
import type { OcrCropRect } from './staffDetector.ts';

type TesseractModule = typeof import('tesseract.js');

/** 当前 OCR 进度回调（logger 每次识别时读取） */
let currentProgress: ((msg: string) => void) | null = null;
let workerPromise: Promise<Tesseract.Worker> | null = null;

/** 懒加载 Tesseract 单例（首次调用初始化 worker + 语言包） */
function getWorker(): Promise<Tesseract.Worker> {
    if (!workerPromise) {
        workerPromise = (async () => {
            const t = await import('tesseract.js');
            const mod = (t as { default?: TesseractModule }).default ?? (t as unknown as TesseractModule);
            // 关闭 tesseract 转发的 worker 日志（"Estimating resolution as NNN"、"Detected N diacritics" 等噪音）
            mod.setLogging(false);
            // 用 legacy 引擎（TESSERACT_ONLY）：tessedit_char_whitelist 对它生效，
            // 实测纯数字召回是 LSTM 的 2 倍以上（8→17）。需 legacyCore/legacyLang + legacy traineddata。
            const worker = await mod.createWorker(
                'eng',
                mod.OEM.TESSERACT_ONLY,
                {
                    // 用静音包装器 worker：压掉 tesseract 原生内核的 console 噪音
                    workerPath: new URL('tessdata/tesseract-worker-silent.js', document.baseURI).href,
                    corePath: coreUrl,
                    langPath: new URL('tessdata/', document.baseURI).href,
                    workerBlobURL: false,
                    cacheMethod: 'none',
                    gzip: true,
                    legacyCore: true,
                    legacyLang: true,
                    logger: (m) => {
                        if (currentProgress && m.status === 'recognizing text') {
                            currentProgress(`OCR 识别中 ${Math.round((m.progress ?? 0) * 100)}%`);
                        }
                    },
                },
                {
                    load_system_dawg: '0',
                    load_freq_dawg: '0',
                    load_number_dawg: '0',
                    load_punc_dawg: '0',
                },
            );
            await worker.setParameters({
                tessedit_pageseg_mode: mod.PSM.SPARSE_TEXT,
                tessedit_char_whitelist: '0123456789',
            });
            return worker;
        })();
    }
    return workerPromise;
}

/** 识别谱表裁剪区，返回用户空间 PlainTextItem[]（仅数字） */
export async function ocrStaffCrop(
    pageCanvas: HTMLCanvasElement,
    crop: OcrCropRect,
    viewport: PixelToUserMapper,
    onProgress?: (msg: string) => void,
): Promise<PlainTextItem[]> {
    const worker = await getWorker();
    currentProgress = onProgress ?? null;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = crop.w;
    cropCanvas.height = crop.h;
    const ctx = cropCanvas.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(pageCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

    const { data } = await worker.recognize(cropCanvas, {}, { text: true, blocks: true });
    return flattenWords(data)
        .filter(w => /^\d{1,2}$/.test(w.text.trim()) && w.confidence >= OCR_IMPORT_CONFIG.digitConfidenceMin)
        .map(w => wordToPlainTextItem(w, crop, viewport))
        .filter((it): it is PlainTextItem => it !== null);
}

/** 拍平识别结果的 words */
function flattenWords(page: Tesseract.Page): Tesseract.Word[] {
    if (!page.blocks) return [];
    const out: Tesseract.Word[] = [];
    for (const b of page.blocks) {
        for (const p of b.paragraphs ?? []) {
            for (const l of p.lines ?? []) {
                for (const w of l.words ?? []) out.push(w);
            }
        }
    }
    return out;
}

/** OCR word（裁剪像素坐标）→ 用户空间 PlainTextItem */
function wordToPlainTextItem(
    word: Tesseract.Word,
    crop: OcrCropRect,
    viewport: PixelToUserMapper,
): PlainTextItem | null {
    const { bbox } = word;
    const bx0 = bbox.x0 + crop.x;
    const bx1 = bbox.x1 + crop.x;
    const by0 = bbox.y0 + crop.y;
    const by1 = bbox.y1 + crop.y;
    const centerY = (by0 + by1) / 2;

    const [x0u] = viewport.convertToPdfPoint(bx0, 0);
    const [x1u] = viewport.convertToPdfPoint(bx1, 0);
    const [, y0u] = viewport.convertToPdfPoint(0, by0);
    const [, y1u] = viewport.convertToPdfPoint(0, by1);
    const fontHeight = Math.abs(y1u - y0u);
    const width = Math.abs(x1u - x0u);
    const [hMin, hMax] = OCR_IMPORT_CONFIG.digitHeightUserRange;
    if (fontHeight < hMin || fontHeight > hMax) return null;

    const [, cyu] = viewport.convertToPdfPoint(0, centerY);
    const x = viewport.convertToPdfPoint(bx0, centerY)[0];
    const fret = parseInt(word.text.trim(), 10);
    if (fret > 24) return null; // 品数不可能 >24，OCR 误识的两位数直接丢弃
    // 基线 y = 字形中心 - fontHeight × textBaselineToCenter（与 parsePdf 一致）
    const y = cyu - fontHeight * PDF_IMPORT_CONFIG.textBaselineToCenter;
    return { str: word.text.trim(), x, y, fontHeight, width };
}
