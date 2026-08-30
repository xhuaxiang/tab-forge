/**
 * tabGeometry — PDF 解析中间几何类型（纯数据结构，无 pdfjs 依赖）
 *
 * pdfjs 提取的原始几何（文本项 + 线段）以扁平结构表示，
 * 供 pdfImport/parsePdf.ts 纯函数解析为 TabScore。
 * 全部坐标均为 PDF 用户空间（y 轴向上）。
 */

/** 扁平化文本项（pdfjs TextItem → 纯几何） */
export interface PlainTextItem {
    /** 文本内容 */
    str: string;
    /** 左边缘 x（transform[4]） */
    x: number;
    /** 基线 y（transform[5]） */
    y: number;
    /** 近似字号（|transform[3]|） */
    fontHeight: number;
    /** 用户空间近似宽度 */
    width: number;
}

/** 用户空间线段 (x1,y1)-(x2,y2) */
export interface LineSegment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/** 单页几何 */
export interface PageGeometry {
    pageIndex: number;
    items: PlainTextItem[];
    segments: LineSegment[];
}

/** 检测到的六线谱（6 条等距线） */
export interface Staff {
    /** 6 个谱线 y（升序：低弦在下、高弦在上） */
    lineYs: number[];
    /** 谱表上沿（最高线之上，含外扩半格） */
    top: number;
    /** 谱表下沿（最低线之下，含外扩半格） */
    bottom: number;
    /** 谱表左边界 x */
    xStart: number;
    /** 谱表右边界 x */
    xEnd: number;
}
