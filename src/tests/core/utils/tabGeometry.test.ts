/**
 * tabGeometry 单元测试
 *
 * 覆盖：弦行网格的锚点拟合/fallback、y ↔ 弦行反查（中心/容差/越界）、
 * x → 拍位下标（第一拍前/中间/最后一拍右/空数组/小节尾）。
 */

import { describe, it, expect } from 'vitest';
import {
    makeStaffGrid,
    tabRowAtY,
    tabRowY,
    resolveSlotIndexAtX,
} from '../../../core/utils/tabGeometry.ts';

/** topY=100、间距=10、6 弦：alphaTab 行 6 = 顶线 y=100，行 1 = 底线 y=150 */
function grid(stringCount = 6) {
    return makeStaffGrid({
        anchors: [],
        fallbackTopY: 100,
        fallbackRowSpacing: 10,
        stringCount,
    });
}

describe('makeStaffGrid', () => {
    it('两个不同行锚点 → 最小二乘还原 topY / rowSpacing', () => {
        const g = makeStaffGrid({
            anchors: [
                { y: 150, row: 1 },
                { y: 100, row: 6 },
            ],
            fallbackTopY: 0,
            fallbackRowSpacing: 99,
            stringCount: 6,
        });
        expect(g.topY).toBeCloseTo(100, 6);
        expect(g.rowSpacing).toBeCloseTo(10, 6);
    });

    it('多个锚点带微小噪声时仍取拟合值', () => {
        const g = makeStaffGrid({
            anchors: [
                { y: 150.2, row: 1 },
                { y: 130, row: 3 },
                { y: 100.1, row: 6 },
            ],
            fallbackTopY: 0,
            fallbackRowSpacing: 99,
            stringCount: 6,
        });
        expect(g.topY).toBeGreaterThan(99);
        expect(g.topY).toBeLessThan(101);
        expect(g.rowSpacing).toBeGreaterThan(9.5);
        expect(g.rowSpacing).toBeLessThan(10.5);
    });

    it('单个锚点 → 用 fallback 间距推 topY', () => {
        const g = makeStaffGrid({
            anchors: [{ y: 148, row: 1 }],
            fallbackTopY: 0,
            fallbackRowSpacing: 12,
            stringCount: 6,
        });
        expect(g.topY).toBeCloseTo(88, 6); // 148 - (6-1)*12
        expect(g.rowSpacing).toBe(12);
    });

    it('同一行的多个锚点取平均 y', () => {
        const g = makeStaffGrid({
            anchors: [{ y: 148, row: 1 }, { y: 152, row: 1 }],
            fallbackTopY: 0,
            fallbackRowSpacing: 10,
            stringCount: 6,
        });
        expect(g.topY).toBeCloseTo(150 - 5 * 10, 6);
    });

    it('没有锚点 → 原样使用 fallback', () => {
        const g = makeStaffGrid({
            anchors: [],
            fallbackTopY: 77,
            fallbackRowSpacing: 9,
            stringCount: 6,
        });
        expect(g).toEqual({ topY: 77, rowSpacing: 9, stringCount: 6 });
    });

    it('非法 fallback 间距归零，不产生 NaN', () => {
        const g = makeStaffGrid({
            anchors: [],
            fallbackTopY: NaN,
            fallbackRowSpacing: -1,
            stringCount: 6,
        });
        expect(g.topY).toBe(0);
        expect(g.rowSpacing).toBe(0);
    });

    it('锚点行号不连续（1 与 3）时仍按两点拟合', () => {
        const g = makeStaffGrid({
            anchors: [{ y: 150, row: 1 }, { y: 130, row: 3 }],
            fallbackTopY: 0,
            fallbackRowSpacing: 99,
            stringCount: 6,
        });
        // r: row1→5(y=150)、row3→3(y=130)，斜率 10，topY = 150 - 5*10
        expect(g.topY).toBeCloseTo(100, 6);
        expect(g.rowSpacing).toBeCloseTo(10, 6);
    });

    it('含 NaN / Infinity 的锚点被过滤后仍用剩余锚点拟合', () => {
        const g = makeStaffGrid({
            anchors: [
                { y: NaN, row: 3 },
                { y: 130, row: 3 },
                { y: 100, row: 6 },
                { y: 150, row: Infinity },
                { y: Infinity, row: 1 },
            ],
            fallbackTopY: 0,
            fallbackRowSpacing: 99,
            stringCount: 6,
        });
        // 有效锚点只剩 (130,row3) 与 (100,row6)
        expect(g.topY).toBeCloseTo(100, 6);
        expect(g.rowSpacing).toBeCloseTo(10, 6);
    });

    it('拟合出非正间距（y 随行号递增）时整体回退 fallback', () => {
        const g = makeStaffGrid({
            anchors: [{ y: 100, row: 1 }, { y: 150, row: 6 }],
            fallbackTopY: 77,
            fallbackRowSpacing: 9,
            stringCount: 6,
        });
        expect(g).toEqual({ topY: 77, rowSpacing: 9, stringCount: 6 });
    });

    it('fallback 间距为 0 且只有单个锚点时，topY 等于该行 y', () => {
        const g = makeStaffGrid({
            anchors: [{ y: 148, row: 1 }],
            fallbackTopY: 0,
            fallbackRowSpacing: 0,
            stringCount: 6,
        });
        expect(g.topY).toBe(148);
        expect(g.rowSpacing).toBe(0);
    });

    it('stringCount < 2 时至少保留 1 行，非整数向下取整', () => {
        expect(makeStaffGrid({ anchors: [], fallbackTopY: 50, fallbackRowSpacing: 10, stringCount: 0 }).stringCount).toBe(1);
        expect(makeStaffGrid({ anchors: [], fallbackTopY: 50, fallbackRowSpacing: 10, stringCount: -3 }).stringCount).toBe(1);
        expect(makeStaffGrid({ anchors: [], fallbackTopY: 50, fallbackRowSpacing: 10, stringCount: 6.9 }).stringCount).toBe(6);

        const one = makeStaffGrid({
            anchors: [{ y: 70, row: 1 }],
            fallbackTopY: 0,
            fallbackRowSpacing: 10,
            stringCount: 1,
        });
        expect(one).toEqual({ topY: 70, rowSpacing: 10, stringCount: 1 });
    });

    it('非有限 stringCount 退回 1，不产生 NaN 网格', () => {
        for (const bad of [NaN, Infinity, -Infinity]) {
            const g = makeStaffGrid({
                anchors: [],
                fallbackTopY: 50,
                fallbackRowSpacing: 10,
                stringCount: bad,
            });
            expect(g.stringCount, `stringCount=${bad}`).toBe(1);
            expect(Number.isFinite(g.topY)).toBe(true);
            expect(Number.isFinite(g.rowSpacing)).toBe(true);
        }
    });

    it('行号不在 1..stringCount 的锚点被过滤', () => {
        const g = makeStaffGrid({
            anchors: [
                { y: 999, row: 0 },
                { y: 999, row: 7 },
                { y: 150, row: 1 },
                { y: 100, row: 6 },
            ],
            fallbackTopY: 0,
            fallbackRowSpacing: 99,
            stringCount: 6,
        });
        // 只用 (150,row1)、(100,row6)，越界锚点不参与拟合
        expect(g.topY).toBeCloseTo(100, 6);
        expect(g.rowSpacing).toBeCloseTo(10, 6);
    });

    it('锚点行号全部越界时按无锚点回退 fallback', () => {
        const g = makeStaffGrid({
            anchors: [{ y: 10, row: 0 }, { y: 20, row: 9 }],
            fallbackTopY: 77,
            fallbackRowSpacing: 9,
            stringCount: 6,
        });
        expect(g).toEqual({ topY: 77, rowSpacing: 9, stringCount: 6 });
    });
});

describe('tabRowY / tabRowAtY', () => {
    it('行号 6 = 顶线，行号 1 = 底线', () => {
        const g = grid();
        expect(tabRowY(g, 6)).toBeCloseTo(100, 6);
        expect(tabRowY(g, 1)).toBeCloseTo(150, 6);
        expect(tabRowY(g, 3)).toBeCloseTo(130, 6);
    });

    it('中心处反查回原行号', () => {
        const g = grid();
        for (let row = 1; row <= 6; row++) {
            expect(tabRowAtY(g, tabRowY(g, row))).toBe(row);
        }
    });

    it('容差内吸附到最近行，容差外返回 null', () => {
        const g = grid();
        expect(tabRowAtY(g, 103, 0.5)).toBe(6);
        expect(tabRowAtY(g, 107, 0.5)).toBe(5);
        expect(tabRowAtY(g, 101, 0.2)).toBe(6); // 偏离 0.1 行
        expect(tabRowAtY(g, 103, 0.2)).toBeNull(); // 偏离 0.3 行
    });

    it('越过顶/底弦返回 null', () => {
        const g = grid();
        expect(tabRowAtY(g, 90)).toBeNull();
        expect(tabRowAtY(g, 160)).toBeNull();
        expect(tabRowAtY(g, NaN)).toBeNull();
    });

    it('间距为 0 的退化网格返回 null', () => {
        const g = makeStaffGrid({ anchors: [], fallbackTopY: 100, fallbackRowSpacing: 0, stringCount: 6 });
        expect(tabRowAtY(g, 100)).toBeNull();
    });

    it('偏离恰等于容差时仍吸附（实现为 > 才拒绝），略小则拒绝', () => {
        const g = grid();
        // y=105 → raw=5.5 → 最近行 6，偏离 0.5 行
        expect(tabRowAtY(g, 105, 0.5)).toBe(6);
        expect(tabRowAtY(g, 105, 0.4999)).toBeNull();
    });

    it('首行上方 / 末行下方一行以内的 y 仍能吸附', () => {
        const g = grid();
        expect(tabRowAtY(g, 99.9)).toBe(6);
        expect(tabRowAtY(g, 150.1)).toBe(1);
        // 末行下方恰好半行：raw=0.5 → 最近行 1，仍在默认容差内
        expect(tabRowAtY(g, 155)).toBe(1);
        expect(tabRowAtY(g, 155.1)).toBeNull();
    });

    it('7 弦网格的行号往返', () => {
        const g7 = makeStaffGrid({
            anchors: [],
            fallbackTopY: 100,
            fallbackRowSpacing: 10,
            stringCount: 7,
        });
        expect(tabRowY(g7, 7)).toBeCloseTo(100, 6);
        expect(tabRowY(g7, 1)).toBeCloseTo(160, 6);
        for (let row = 1; row <= 7; row++) {
            expect(tabRowAtY(g7, tabRowY(g7, row))).toBe(row);
        }
    });

    it('间距为负 / stringCount < 1 的网格返回 null', () => {
        expect(tabRowAtY({ topY: 100, rowSpacing: -10, stringCount: 6 }, 100)).toBeNull();
        expect(tabRowAtY({ topY: 100, rowSpacing: 10, stringCount: 0 }, 100)).toBeNull();
    });

    it('非有限 stringCount / rowSpacing / topY 的网格返回 null（不产生 NaN 行号）', () => {
        expect(tabRowAtY({ topY: 100, rowSpacing: 10, stringCount: NaN }, 100)).toBeNull();
        expect(tabRowAtY({ topY: 100, rowSpacing: 10, stringCount: Infinity }, 100)).toBeNull();
        expect(tabRowAtY({ topY: 100, rowSpacing: NaN, stringCount: 6 }, 100)).toBeNull();
        expect(tabRowAtY({ topY: NaN, rowSpacing: 10, stringCount: 6 }, 100)).toBeNull();
    });

    it('单弦网格：只能命中行 1', () => {
        const g1 = makeStaffGrid({ anchors: [], fallbackTopY: 100, fallbackRowSpacing: 10, stringCount: 1 });
        expect(tabRowAtY(g1, 100)).toBe(1);
        // raw = 0 → 最近行 0，已在 1..stringCount 之外
        expect(tabRowAtY(g1, 110)).toBeNull();
    });
});

describe('resolveSlotIndexAtX', () => {
    const beats = [{ x: 100, width: 20 }, { x: 120, width: 20 }];
    const bar = { x: 90, width: 60 };

    it('第一拍起点左侧 → slot 0', () => {
        expect(resolveSlotIndexAtX(80, beats, bar)).toEqual({ kind: 'slot', index: 0 });
        expect(resolveSlotIndexAtX(99, beats, bar)).toEqual({ kind: 'slot', index: 0 });
    });

    it('拍位内部/边界 → 对应 slot', () => {
        expect(resolveSlotIndexAtX(100, beats, bar)).toEqual({ kind: 'slot', index: 0 });
        expect(resolveSlotIndexAtX(110, beats, bar)).toEqual({ kind: 'slot', index: 0 });
        expect(resolveSlotIndexAtX(120, beats, bar)).toEqual({ kind: 'slot', index: 1 });
        expect(resolveSlotIndexAtX(140, beats, bar)).toEqual({ kind: 'slot', index: 1 });
    });

    it('最后一拍右边界之外 → end（小节尾）', () => {
        expect(resolveSlotIndexAtX(141, beats, bar)).toEqual({ kind: 'end' });
    });

    it('空隙归前一拍', () => {
        expect(resolveSlotIndexAtX(118, [{ x: 100, width: 10 }, { x: 130, width: 10 }], bar))
            .toEqual({ kind: 'slot', index: 0 });
    });

    it('空拍数组：小节范围内 → end，范围外 → null', () => {
        expect(resolveSlotIndexAtX(110, [], bar)).toEqual({ kind: 'end' });
        expect(resolveSlotIndexAtX(10, [], bar)).toBeNull();
    });

    it('非法 x → null', () => {
        expect(resolveSlotIndexAtX(NaN, beats, bar)).toBeNull();
        expect(resolveSlotIndexAtX(Infinity, beats, bar)).toBeNull();
        expect(resolveSlotIndexAtX(-Infinity, beats, bar)).toBeNull();
    });

    it('单拍：起点与右边界都属于它，越界即 end', () => {
        const single = [{ x: 100, width: 20 }];
        expect(resolveSlotIndexAtX(100, single, bar)).toEqual({ kind: 'slot', index: 0 });
        expect(resolveSlotIndexAtX(99.5, single, bar)).toEqual({ kind: 'slot', index: 0 });
        expect(resolveSlotIndexAtX(120, single, bar)).toEqual({ kind: 'slot', index: 0 });
        expect(resolveSlotIndexAtX(120.1, single, bar)).toEqual({ kind: 'end' });
    });

    it('零宽拍：起点归该拍，右侧即 end', () => {
        const zero = [{ x: 100, width: 0 }];
        expect(resolveSlotIndexAtX(99.9, zero, bar)).toEqual({ kind: 'slot', index: 0 });
        expect(resolveSlotIndexAtX(100, zero, bar)).toEqual({ kind: 'slot', index: 0 });
        expect(resolveSlotIndexAtX(100.1, zero, bar)).toEqual({ kind: 'end' });
    });

    it('bar 宽度为 0 且无拍：仅 bar.x 一点算 end', () => {
        const bar0 = { x: 10, width: 0 };
        expect(resolveSlotIndexAtX(10, [], bar0)).toEqual({ kind: 'end' });
        expect(resolveSlotIndexAtX(9.9, [], bar0)).toBeNull();
        expect(resolveSlotIndexAtX(10.1, [], bar0)).toBeNull();
    });

    it('拍数组未按 x 排序时不纠正：首尾判断仍取数组首尾元素', () => {
        // 实现依赖 beats 升序：首元素起点与末元素右边界直接决定边界
        const unsorted = [{ x: 120, width: 10 }, { x: 100, width: 10 }];
        // 105 / 115 在第二拍（100~110）内，却因小于首元素起点 120 被判为 slot 0
        expect(resolveSlotIndexAtX(105, unsorted, bar)).toEqual({ kind: 'slot', index: 0 });
        expect(resolveSlotIndexAtX(115, unsorted, bar)).toEqual({ kind: 'slot', index: 0 });
        // 120 不早于首元素起点，随后撞上末元素右边界（110）→ 小节尾
        expect(resolveSlotIndexAtX(120, unsorted, bar)).toEqual({ kind: 'end' });
        // 125 落在首拍（120~130）范围内，仍被末元素右边界挡掉
        expect(resolveSlotIndexAtX(125, unsorted, bar)).toEqual({ kind: 'end' });
    });

    it('x 在 bar 左端但位于第一拍起点左侧 → slot 0', () => {
        expect(resolveSlotIndexAtX(bar.x, beats, bar)).toEqual({ kind: 'slot', index: 0 });
    });
});
