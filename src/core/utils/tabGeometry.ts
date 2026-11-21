/**
 * tabGeometry — 六线谱几何反查（纯函数，无 DOM / 无 alphaTab 依赖）
 *
 * 调用方把 alphaTab 的 noteHeadBounds / beatBounds 中心换算成这里需要的
 * 原始值结构；本文件只做「y ↔ 弦行」「x ↔ 拍位」的数学。
 *
 * 行号口径与 alphaTab 弦号一致：1 = 最底弦，stringCount = 最顶弦。
 * 内部按「顶行 = 0」换算后再拟合，`topY` 是最顶弦的 y。
 */

export interface TabStaffGrid {
    /** 最顶弦（行号 = stringCount）的 y */
    topY: number;
    /** 相邻弦的 y 间距（正数，向下增大） */
    rowSpacing: number;
    /** 弦数（六线谱为 6） */
    stringCount: number;
}

export interface StaffAnchor {
    /** 该弦行在谱面坐标系中的中心 y */
    y: number;
    /** alphaTab 弦号口径的行号（1 = 最底弦） */
    row: number;
}

export interface TabSlotSpan {
    x: number;
    width: number;
}

export interface TabBarSpan {
    x: number;
    width: number;
}

/**
 * 用已知锚点拟合弦行网格。
 *
 * - ≥2 个不同行号的锚点：最小二乘拟合 `y = topY + (stringCount - row) * rowSpacing`
 * - 只有 1 个（或全部同一行）：用 fallback 间距推 topY
 * - 没有锚点：topY 与间距都用 fallback
 *
 * 拟合结果非有限 / 间距非正时回退到 fallback，保证返回值总是可用。
 */
export function makeStaffGrid(input: {
    anchors: readonly StaffAnchor[];
    fallbackTopY: number;
    fallbackRowSpacing: number;
    stringCount: number;
}): TabStaffGrid {
    // 非有限弦数没有合法行号区间：退回单行，避免 Math.floor(NaN) 产生 NaN
    const stringCount = Number.isFinite(input.stringCount)
        ? Math.max(1, Math.floor(input.stringCount))
        : 1;
    const fallbackSpacing = Number.isFinite(input.fallbackRowSpacing) && input.fallbackRowSpacing > 0
        ? input.fallbackRowSpacing
        : 0;

    // 行号必须落在 1..stringCount（alphaTab 弦号口径），区间外的锚点不参与拟合
    const valid = input.anchors.filter(a =>
        Number.isFinite(a.y) && Number.isFinite(a.row)
        && a.row >= 1 && a.row <= stringCount,
    );
    const rows = new Set(valid.map(a => a.row));

    if (valid.length >= 2 && rows.size >= 2) {
        // 以顶行为 0 的坐标 r 拟合，避免 alphaTab 行号方向导致斜率为负
        const points = valid.map(a => ({ r: stringCount - a.row, y: a.y }));
        const meanR = points.reduce((s, p) => s + p.r, 0) / points.length;
        const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
        let cov = 0;
        let varR = 0;
        for (const p of points) {
            cov += (p.r - meanR) * (p.y - meanY);
            varR += (p.r - meanR) * (p.r - meanR);
        }
        if (varR > 1e-9) {
            const spacing = cov / varR;
            const topY = meanY - spacing * meanR;
            if (Number.isFinite(spacing) && spacing > 1e-9 && Number.isFinite(topY)) {
                return { topY, rowSpacing: spacing, stringCount };
            }
        }
    }

    if (valid.length > 0 && rows.size === 1) {
        // 同一行可能被多个音符重复采样，取平均 y 更稳
        const y = valid.reduce((s, a) => s + a.y, 0) / valid.length;
        const r = stringCount - valid[0].row;
        return { topY: y - r * fallbackSpacing, rowSpacing: fallbackSpacing, stringCount };
    }

    return {
        topY: Number.isFinite(input.fallbackTopY) ? input.fallbackTopY : 0,
        rowSpacing: fallbackSpacing,
        stringCount,
    };
}

/** 行号（alphaTab 弦号）→ y；网格不可用时返回 topY */
export function tabRowY(grid: TabStaffGrid, row: number): number {
    return grid.topY + (grid.stringCount - row) * grid.rowSpacing;
}

/**
 * y → 行号（alphaTab 弦号）。容差之外或越界返回 null，调用方降级为「不定位弦」。
 *
 * @param toleranceRows 允许偏离最近弦行的行距倍数（默认半行）
 */
export function tabRowAtY(grid: TabStaffGrid, y: number, toleranceRows = 0.5): number | null {
    if (!Number.isFinite(y)
        || !Number.isFinite(grid.topY)
        || !Number.isFinite(grid.rowSpacing)
        || grid.rowSpacing <= 0
        || !Number.isFinite(grid.stringCount)
        || grid.stringCount < 1) return null;
    const raw = grid.stringCount - (y - grid.topY) / grid.rowSpacing;
    const nearest = Math.round(raw);
    if (nearest < 1 || nearest > grid.stringCount) return null;
    if (Math.abs(raw - nearest) > toleranceRows) return null;
    return nearest;
}

export type SlotIndexAtX =
    | { kind: 'slot'; index: number }
    | { kind: 'end' };

/**
 * x → 拍位下标。
 *
 * 前置条件：`beats` 必须按 `x` 升序（alphaTab 的 beat 渲染顺序保证这一点）。
 * 本函数不排序：乱序输入会被当作未定义行为，由调用方保证来源。
 *
 * - x 落在第一拍起点左侧：slot 0
 * - x 落在最后一拍右边界右侧：end（小节尾）
 * - 其余：最后一个起点 ≤ x 的 slot（空隙归前一拍）
 * - beats 为空：x 在小节范围内视为 end，否则 null
 */
export function resolveSlotIndexAtX(
    x: number,
    beats: readonly TabSlotSpan[],
    bar: TabBarSpan,
): SlotIndexAtX | null {
    if (!Number.isFinite(x)) return null;

    if (beats.length === 0) {
        if (x >= bar.x && x <= bar.x + bar.width) return { kind: 'end' };
        return null;
    }

    if (x < beats[0].x) return { kind: 'slot', index: 0 };

    const last = beats[beats.length - 1];
    if (x > last.x + last.width) return { kind: 'end' };

    let index = 0;
    for (let i = 0; i < beats.length; i++) {
        if (beats[i].x <= x) index = i;
        else break;
    }
    return { kind: 'slot', index };
}
