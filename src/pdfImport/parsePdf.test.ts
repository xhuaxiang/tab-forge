/**
 * parsePdf 纯解析单测 — 手造 PageGeometry fixture，不加载 pdfjs / worker。
 *
 * fixture 约定：PDF 用户空间 y 向上；字形中心 = 基线 + 0.4×字高（textBaselineToCenter）。
 */

import { describe, it, expect } from 'vitest';
import { parseTabGeometry } from './parsePdf.ts';
import type { PageGeometry, PlainTextItem, LineSegment } from './tabGeometry.ts';

/** 造文本项：指定中心 cx / 字形中心 centerY（默认字高 10） */
function item(str: string, cx: number, centerY: number, fontHeight = 10): PlainTextItem {
    const width = str.length * fontHeight * 0.5;
    return { str, x: cx - width / 2, y: centerY - fontHeight * 0.4, fontHeight, width };
}

/** 水平谱线段 */
function hLine(y: number, x1 = 50, x2 = 450): LineSegment {
    return { x1, y1: y, x2, y2: y };
}

/** 垂直小节线段 */
function vLine(x: number, y1 = 95, y2 = 155): LineSegment {
    return { x1: x, y1, x2: x, y2 };
}

/**
 * 标准 fixture：1 个六线谱谱表（y 100..150，间距 10，x 50..450），
 * 小节线在 x=50/150/250/350/450 → 4 小节。
 * 谱表弦序（lineYs 升序）：100→6弦, 110→5弦, 120→4弦, 130→3弦, 140→2弦, 150→1弦。
 */
function makeFixture(): PageGeometry {
    const segments: LineSegment[] = [];
    for (const y of [100, 110, 120, 130, 140, 150]) segments.push(hLine(y));
    for (const x of [50, 150, 250, 350, 450]) segments.push(vLine(x));

    const items: PlainTextItem[] = [
        item('Test Song', 200, 190, 20),          // 标题（大字号，谱表上方）
        item('4/4', 30, 125),                      // 拍号（谱表左缘）
        // 小节1 [50,150]：和弦 + 两个单音（等距拍位）
        item('3', 75, 150),                        // 1弦 3品
        item('5', 76, 140),                        // 2弦 5品（与上一项成和弦）
        item('7', 100, 130),                       // 3弦 7品
        item('9', 125, 120),                       // 4弦 9品
        // 小节2 [150,250]：两位数合并 + 空弦
        item('1', 175, 120),                       // 4弦 "1"...
        item('2', 179, 120),                       // 4弦 ..."2" → 12品
        item('0', 225, 150),                       // 1弦 空弦
        // 小节3 [250,350]：击弦标记
        item('h', 300, 110),                       // 5弦 技法标记
        item('9', 315, 110),                       // 5弦 9品（h 目标）
        // 小节4 [350,450]：推弦标记
        item('b2', 370, 100),                      // 6弦 技法标记
        item('8', 390, 100),                       // 6弦 8品（b2 目标）
    ];

    return { pageIndex: 0, items, segments };
}

describe('parseTabGeometry', () => {
    it('识别谱表、小节与拍号', () => {
        const score = parseTabGeometry([makeFixture()]);
        expect(score.measures).toHaveLength(4);
        expect(score.timeSignature).toBe('4/4');
        expect(score.title).toBe('Test Song');
        for (const m of score.measures) {
            expect(m.timeSignatureNumerator).toBe(4);
            expect(m.timeSignatureDenominator).toBe(4);
        }
    });

    it('映射品数/弦号，x 近等的数字组成和弦', () => {
        const score = parseTabGeometry([makeFixture()]);
        const m1 = score.measures[0];
        expect(m1.notes).toHaveLength(4);
        const [a, b, c, d] = m1.notes;
        expect(a).toMatchObject({ string: 1, fret: 3 });
        expect(b).toMatchObject({ string: 2, fret: 5 });
        expect(c).toMatchObject({ string: 3, fret: 7 });
        expect(d).toMatchObject({ string: 4, fret: 9 });
        expect(a.chordGroup).toBeDefined();
        expect(a.chordGroup).toBe(b.chordGroup);   // 同拍和弦共享 group
        expect(c.chordGroup).toBeUndefined();       // 单音无 group
        expect(a.duration).toBe(0.25);              // 等距拍位 → 四分
    });

    it('同弦相邻数字合并为两位数品位，空弦映射为 0', () => {
        const score = parseTabGeometry([makeFixture()]);
        const m2 = score.measures[1];
        expect(m2.notes).toHaveLength(2);
        expect(m2.notes[0]).toMatchObject({ string: 4, fret: 12 });
        expect(m2.notes[1]).toMatchObject({ string: 1, fret: 0 });
    });

    it('识别技法标记（击弦/推弦）', () => {
        const score = parseTabGeometry([makeFixture()]);
        const m3 = score.measures[2];
        const m4 = score.measures[3];
        expect(m3.notes).toHaveLength(1);
        expect(m3.notes[0]).toMatchObject({ string: 5, fret: 9, technique: 'hammerOn' });
        expect(m4.notes).toHaveLength(1);
        expect(m4.notes[0]).toMatchObject({ string: 6, fret: 8, technique: 'bend', bendAmount: 2 });
    });

    it('空小节保持为空', () => {
        const page: PageGeometry = {
            pageIndex: 0,
            items: [item('4/4', 30, 125)],
            segments: [
                hLine(100, 50, 150), hLine(110, 50, 150), hLine(120, 50, 150),
                hLine(130, 50, 150), hLine(140, 50, 150), hLine(150, 50, 150),
                vLine(50, 95, 155), vLine(150, 95, 155),
            ],
        };
        const score = parseTabGeometry([page]);
        expect(score.measures).toHaveLength(1);
        expect(score.measures[0].notes).toHaveLength(0);
    });

    it('无谱表时返回空谱', () => {
        const score = parseTabGeometry([{ pageIndex: 0, items: [], segments: [] }]);
        expect(score.measures).toHaveLength(0);
    });
});
