/**
 * parsePdf — PDF 六线谱解析（纯函数核心，无 pdfjs 依赖）
 *
 * - parsePdfFile(arrayBuffer)：动态加载 pdfLoader 做 IO 提取 → 纯解析。
 * - parseTabGeometry(pages)：几何数据 → TabScore 的纯映射，可独立单测
 *   （fixture 直接造 PageGeometry，不加载 pdfjs / worker）。
 *
 * 目标布局：Guitar Pro 导出的 PDF（6 线谱表 + 品数文本 + 小节线）。
 * 时值为粗略推断（GP 节奏其实编码在符干/符梁里），阈值集中在 PDF_IMPORT_CONFIG。
 */

import type { Measure, Note, NoteDuration, TabScore } from '../types/index.ts';
import { SCORE_DEFAULTS, PDF_IMPORT_CONFIG } from '../config.ts';
import type { LineSegment, PageGeometry, PlainTextItem, Staff } from './tabGeometry.ts';

const CFG = PDF_IMPORT_CONFIG;

/** 已定位的音符（携带几何位置，供合并/分组/技法使用） */
interface PlacedNote {
    string: number;
    fret: number;
    cx: number;
    cy: number;
    fontHeight: number;
    technique?: Note['technique'];
    bendAmount?: number;
    bendRelease?: boolean;
}

/** 一个拍位：单音或和弦（共享 chordGroup） */
interface Slot {
    placed: PlacedNote[];
    chordGroup?: number;
    duration: NoteDuration;
}

/** 水平线段（用户空间） */
export interface HLine { y: number; x1: number; x2: number }
/** 垂直线段（用户空间） */
export interface VLine { x: number; y1: number; y2: number }

// ============================================================
// 入口
// ============================================================

/**
 * 解析 PDF 文件字节 → TabScore。
 * 主路径：矢量解析；矢量读不出（扫描/图片 PDF）→ 懒加载 OCR 回退。
 * @param onProgress 可选进度回调（OCR 识别阶段用），入参为状态消息
 */
export async function parsePdfFile(
    arrayBuffer: ArrayBuffer,
    onProgress?: (msg: string) => void,
): Promise<TabScore> {
    // pdfjs getDocument 会把 data transfer 给 worker，导致原 buffer 被 detach。
    // 若矢量读不出要走 OCR 回退，需用提前拷贝的副本（否则二次使用抛 detached 错误）。
    const ocrBuffer = arrayBuffer.slice(0);
    const { extractGeometry } = await import('./pdfLoader.ts');
    const score = parseTabGeometry(await extractGeometry(arrayBuffer));
    if (score.measures.length > 0) return score;
    const { parsePdfOcr } = await import('./ocr/index.ts');
    return parsePdfOcr(ocrBuffer, onProgress);
}

/**
 * 纯解析：几何数据 → TabScore。
 * 逐页检测六线谱谱表，按小节线切小节，文本数字映射品数/弦号，
 * 再推断时值、和弦分组、技法标记。
 */
export function parseTabGeometry(pages: PageGeometry[]): TabScore {
    const allMeasures: Measure[] = [];
    let chordCounter = 1;
    let title = '';
    let timeSig = SCORE_DEFAULTS.timeSignature;
    const bpm = SCORE_DEFAULTS.bpm;

    for (const page of pages) {
        const { hLines, vLines } = classifySegments(page.segments);
        const mergedHLines = mergeHLines(hLines);
        const staffs = detectStaffs(mergedHLines);

        for (const staff of staffs) {
            if (!title) title = detectTitle(page);
            const sig = detectTimeSignature(page, staff);
            if (sig) timeSig = sig;

            const barXs = detectBarXs(vLines, staff);
            const bounds = [staff.xStart, ...barXs, staff.xEnd]
                .filter((x, idx, arr) => arr.indexOf(x) === idx)
                .sort((a, b) => a - b);

            for (let i = 0; i < bounds.length - 1; i++) {
                const x0 = bounds[i];
                const x1 = bounds[i + 1];
                if (x1 - x0 < CFG.minLineLen * 0.5) continue; // 过窄，非有效小节

                const placed = mapNotes(page.items, staff, x0, x1);
                if (placed.length === 0) {
                    allMeasures.push(emptyMeasure(timeSig));
                    continue;
                }
                const grouped = groupIntoSlots(placed, chordCounter);
                chordCounter = grouped.nextCounter;
                assignSlotDurations(grouped.slots, x0, x1, parseTimeSig(timeSig).num);
                applyTechniques(page.items, grouped.slots, staff);
                allMeasures.push(makeMeasure(grouped.slots, timeSig));
            }
        }
    }

    return {
        title: title || 'Imported Score',
        artist: '',
        tuning: { ...SCORE_DEFAULTS.tuning },
        bpm,
        measures: allMeasures.map((m, i) => ({ ...m, index: i })),
        key: SCORE_DEFAULTS.key,
        timeSignature: timeSig,
        remarks: '从 PDF 导入（时值为粗略推断，技法/节奏请人工校验）',
    };
}

// ============================================================
// 线段分类 / 谱表检测 / 小节线
// ============================================================

/** 线段 → 水平 / 垂直分类 */
function classifySegments(segments: LineSegment[]): { hLines: HLine[]; vLines: VLine[] } {
    const hLines: HLine[] = [];
    const vLines: VLine[] = [];
    for (const s of segments) {
        const dx = Math.abs(s.x2 - s.x1);
        const dy = Math.abs(s.y2 - s.y1);
        if (dx >= CFG.minLineLen && dy <= Math.max(dx * 0.05, 2)) {
            hLines.push({ y: (s.y1 + s.y2) / 2, x1: Math.min(s.x1, s.x2), x2: Math.max(s.x1, s.x2) });
        } else if (dy >= CFG.minLineLen && dx <= Math.max(dy * 0.05, 2)) {
            vLines.push({ x: (s.x1 + s.x2) / 2, y1: Math.min(s.y1, s.y2), y2: Math.max(s.y1, s.y2) });
        }
    }
    return { hLines, vLines };
}

/** 水平线按 y 聚类（yClusterTol），同 y 的 x 片段合并为一条 */
export function mergeHLines(hLines: HLine[]): HLine[] {
    const ys = [...new Set(hLines.map(h => h.y))].sort((a, b) => a - b);
    const clusters: number[][] = [];
    for (const y of ys) {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(y - last[0]) <= CFG.yClusterTol) last.push(y);
        else clusters.push([y]);
    }
    const merged: HLine[] = [];
    for (const cl of clusters) {
        const y = cl.reduce((a, b) => a + b, 0) / cl.length;
        let x1 = Infinity;
        let x2 = -Infinity;
        for (const h of hLines) {
            if (Math.abs(h.y - y) <= CFG.yClusterTol) {
                x1 = Math.min(x1, h.x1);
                x2 = Math.max(x2, h.x2);
            }
        }
        merged.push({ y, x1, x2 });
    }
    return merged;
}

/** 在合并后的谱线中找 6 条等距长线 = 一个 tab 谱表（标准记谱是 5 线，靠数量+等距区分） */
export function detectStaffs(merged: HLine[]): Staff[] {
    const candidates = merged
        .filter(h => (h.x2 - h.x1) >= CFG.staffMinWidth)
        .sort((a, b) => a.y - b.y);
    const staffs: Staff[] = [];
    let i = 0;
    while (i <= candidates.length - 6) {
        const window = candidates.slice(i, i + 6);
        const ys = window.map(w => w.y);
        const gap = (ys[5] - ys[0]) / 5;
        const uniform = gap >= CFG.lineSpacing[0] && gap <= CFG.lineSpacing[1]
            && window.every((w, idx) => idx === 0 || Math.abs((w.y - ys[idx - 1]) - gap) <= Math.max(gap * 0.2, 1));
        if (uniform) {
            const xStart = Math.max(...window.map(w => w.x1));
            const xEnd = Math.min(...window.map(w => w.x2));
            if (xEnd - xStart >= CFG.staffMinWidth) {
                staffs.push({ lineYs: ys, top: ys[5] + gap, bottom: ys[0] - gap, xStart, xEnd });
                i += 6;
                continue;
            }
        }
        i++;
    }
    return staffs;
}

/** 谱表内的竖线（y 跨过 ~80% 谱高）聚成小节线 x */
function detectBarXs(vLines: VLine[], staff: Staff): number[] {
    const staffH = staff.top - staff.bottom;
    const xs: number[] = [];
    for (const v of vLines) {
        if (v.x < staff.xStart - CFG.measureEdgeTol || v.x > staff.xEnd + CFG.measureEdgeTol) continue;
        const overlap = Math.min(v.y2, staff.top) - Math.max(v.y1, staff.bottom);
        if (overlap >= staffH * 0.8) xs.push(v.x);
    }
    return clusterXs(xs, CFG.barlineXTol);
}

/** 邻近 x 聚类，返回每簇均值 */
function clusterXs(xs: number[], tol: number): number[] {
    const sorted = [...xs].sort((a, b) => a - b);
    const out: number[] = [];
    for (const x of sorted) {
        const last = out[out.length - 1];
        if (last !== undefined && Math.abs(x - last) <= tol) {
            out[out.length - 1] = (last + x) / 2;
        } else {
            out.push(x);
        }
    }
    return out;
}

// ============================================================
// 元数据（标题 / 拍号）
// ============================================================

/** 标题：字号显著大于页面中位数、非纯数字的最顶部文本 */
function detectTitle(page: PageGeometry): string {
    const fonts = page.items.map(it => it.fontHeight).filter(f => f > 0);
    if (fonts.length === 0) return '';
    const sorted = [...fonts].sort((a, b) => b - a);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    let best: PlainTextItem | null = null;
    let bestScore = 0;
    for (const it of page.items) {
        const txt = it.str.trim();
        if (!txt || /^\d+$/.test(txt)) continue;
        const score = it.fontHeight / median;
        if (score > 1.4 && score > bestScore) {
            bestScore = score;
            best = it;
        }
    }
    return best ? best.str.trim() : '';
}

/** 拍号：谱表左缘的 "n/d" 文本 */
function detectTimeSignature(page: PageGeometry, staff: Staff): string | null {
    for (const it of page.items) {
        const m = it.str.trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
        if (!m) continue;
        const cx = it.x + it.width / 2;
        const cy = it.y + it.fontHeight * CFG.textBaselineToCenter;
        if (cx < staff.xStart && cx > staff.xStart - 80 && cy >= staff.bottom && cy <= staff.top) {
            return `${m[1]}/${m[2]}`;
        }
    }
    return null;
}

// ============================================================
// 音符映射 / 两位数合并 / 和弦分组 / 时值 / 技法
// ============================================================

/** 小节内文本数字 → PlacedNote（最近谱线 = 弦号，数值 = 品数），再做两位数合并 */
function mapNotes(items: PlainTextItem[], staff: Staff, x0: number, x1: number): PlacedNote[] {
    const lineYs = staff.lineYs;
    const gap = (lineYs[lineYs.length - 1] - lineYs[0]) / 5;
    const placed: PlacedNote[] = [];
    for (const it of items) {
        const txt = it.str.trim();
        if (!/^\d{1,2}$/.test(txt)) continue;
        const cx = it.x + it.width / 2;
        const cy = it.y + it.fontHeight * CFG.textBaselineToCenter;
        if (cx < x0 + CFG.measureEdgeTol || cx > x1 - CFG.measureEdgeTol) continue;
        if (cy < lineYs[0] - gap || cy > lineYs[lineYs.length - 1] + gap) continue;
        let best = -1;
        let bestD = Infinity;
        for (let k = 0; k < lineYs.length; k++) {
            const d = Math.abs(lineYs[k] - cy);
            if (d < bestD) { bestD = d; best = k; }
        }
        if (bestD > gap) continue;
        // lineYs 升序：索引 0=低弦(6弦)、5=高弦(1弦)
        placed.push({ string: 6 - best, fret: parseInt(txt, 10), cx, cy, fontHeight: it.fontHeight });
    }
    return mergeTwoDigitFrets(placed);
}

/** 同弦相邻数字项合并为两位数品位（"1"+"2" → 12） */
function mergeTwoDigitFrets(placed: PlacedNote[]): PlacedNote[] {
    const byString = new Map<number, PlacedNote[]>();
    for (const p of placed) {
        const list = byString.get(p.string) ?? [];
        list.push(p);
        byString.set(p.string, list);
    }
    const out: PlacedNote[] = [];
    for (const list of byString.values()) {
        list.sort((a, b) => a.cx - b.cx);
        let i = 0;
        while (i < list.length) {
            const cur = list[i];
            if (i + 1 < list.length) {
                const nxt = list[i + 1];
                const threshold = CFG.numMergeGap * Math.max(cur.fontHeight, nxt.fontHeight);
                const merged = parseInt(`${cur.fret}${nxt.fret}`, 10);
                if (cur.fret <= 2 && nxt.cx - cur.cx <= threshold && merged <= 24) {
                    out.push({ ...cur, fret: merged, cx: (cur.cx + nxt.cx) / 2 });
                    i += 2;
                    continue;
                }
            }
            out.push(cur);
            i++;
        }
    }
    out.sort((a, b) => a.cx - b.cx || a.string - b.string);
    return out;
}

/** 按 x 近等分组成拍位（单音 / 和弦），和弦共享自增 chordGroup */
function groupIntoSlots(placed: PlacedNote[], startId: number): { slots: Slot[]; nextCounter: number } {
    const slots: Slot[] = [];
    let id = startId;
    let current: PlacedNote[] = [];
    const pushCurrent = (): void => {
        if (current.length === 0) return;
        const chordGroup = current.length > 1 ? id++ : undefined;
        slots.push({ placed: current, chordGroup, duration: CFG.defaultDuration });
        current = [];
    };
    for (const p of placed) {
        const last = current[current.length - 1];
        if (current.length === 0 || Math.abs(p.cx - last.cx) <= CFG.chordXTol) {
            current.push(p);
        } else {
            pushCurrent();
            current = [p];
        }
    }
    pushCurrent();
    return { slots, nextCounter: id };
}

/** 时值：按拍位在节内的相对 x 间距 → 最近幂时值（粗略） */
function assignSlotDurations(slots: Slot[], x0: number, x1: number, numerator: number): void {
    const width = x1 - x0;
    if (width <= 0 || slots.length === 0) return;
    const pos = slots.map(s => (s.placed[0].cx - x0) / width);
    for (let i = 0; i < slots.length; i++) {
        const start = pos[i];
        const end = i + 1 < slots.length ? pos[i + 1] : 1;
        slots[i].duration = snapBeatsToDuration((end - start) * numerator);
    }
}

/** 拍数（四分音符=1拍）→ 最近幂时值；相对误差过大则兜底四分 */
function snapBeatsToDuration(beats: number): NoteDuration {
    if (!(beats > 0)) return CFG.defaultDuration;
    let best: NoteDuration = CFG.defaultDuration;
    let bestErr = Infinity;
    for (const d of CFG.durations) {
        const err = Math.abs(d * 4 - beats);
        if (err < bestErr) { bestErr = err; best = d; }
    }
    if (bestErr / beats > 0.5) return CFG.defaultDuration;
    return best;
}

/** 技法文本标记首字符 → 应用技法（只映射现有模型支持的技法） */
function techniqueFromMarker(first: string): Note['technique'] | undefined {
    switch (first) {
        case 'h': case 'H': return 'hammerOn';
        case 'p': case 'P': return 'pullOff';
        case 's': case 'S': case '/': case '\\': return 'slide';
        case 'b': case 'B': return 'bend';
        case '~': case 'v': case 'V': return 'vibrato';
        default: return undefined;
    }
}

/** 技法标记（H/P/S/b/~ 等）就近挂到同弦右侧音符；r/R 标记推弦释放 */
function applyTechniques(items: PlainTextItem[], slots: Slot[], staff: Staff): void {
    const lineYs = staff.lineYs;
    const gap = (lineYs[lineYs.length - 1] - lineYs[0]) / 5;
    const noteRefs: PlacedNote[] = [];
    for (const slot of slots) noteRefs.push(...slot.placed);

    for (const it of items) {
        const txt = it.str.trim();
        if (!txt) continue;
        const mx = it.x + it.width / 2;
        const my = it.y + it.fontHeight * CFG.textBaselineToCenter;
        if (my < lineYs[0] - gap || my > lineYs[lineYs.length - 1] + gap) continue;
        let k = -1;
        let kd = Infinity;
        for (let i = 0; i < lineYs.length; i++) {
            const d = Math.abs(lineYs[i] - my);
            if (d < kd) { kd = d; k = i; }
        }
        if (kd > gap) continue;
        const markerString = 6 - k;
        const tol = CFG.techTol * it.fontHeight;

        // 释放标记：挂到同弦最近的 bend 音符
        const first = txt[0];
        if (first === 'r' || first === 'R') {
            for (const np of noteRefs) {
                if (np.string === markerString && np.technique === 'bend') {
                    np.bendRelease = true;
                    break;
                }
            }
            continue;
        }

        const tech = techniqueFromMarker(first);
        if (!tech) continue;
        // 目标：同弦、cx 在标记右侧且最近（H/P/S/B 的到达音）
        let best: PlacedNote | null = null;
        let bestD = Infinity;
        for (const np of noteRefs) {
            if (np.string !== markerString) continue;
            const d = np.cx - mx;
            if (d < -tol) continue;
            if (d < bestD) { bestD = d; best = np; }
        }
        if (!best || bestD > tol) continue;
        best.technique = tech;
        if (tech === 'bend') {
            const m = txt.match(/(\d+)/);
            if (m) best.bendAmount = Math.min(4, Math.max(0.25, parseInt(m[1], 10)));
        }
    }
}

// ============================================================
// 小节组装
// ============================================================

function makeMeasure(slots: Slot[], timeSig: string): Measure {
    const { num, den } = parseTimeSig(timeSig);
    const notes: Note[] = [];
    for (const slot of slots) {
        for (const p of slot.placed) {
            notes.push({
                string: p.string,
                fret: p.fret,
                duration: slot.duration,
                chordGroup: slot.chordGroup,
                technique: p.technique,
                bendAmount: p.bendAmount,
                bendRelease: p.bendRelease,
            });
        }
    }
    return { index: 0, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

function emptyMeasure(timeSig: string): Measure {
    const { num, den } = parseTimeSig(timeSig);
    return { index: 0, notes: [], timeSignatureNumerator: num, timeSignatureDenominator: den };
}

function parseTimeSig(timeSig: string): { num: number; den: number } {
    const [n, d] = timeSig.split('/').map(Number);
    return { num: n || 4, den: d || 4 };
}
