/**
 * ocrConfig — OCR 回退路径的配置（渲染缩放 / 图像检测阈值）
 *
 * 仅用于「扫描/图片 PDF」。所有坐标最终都经 viewport 转换到 PDF 用户空间，
 * 因此 PDF_IMPORT_CONFIG 的阈值原样复用，这里只放像素级检测的阈值。
 */

export const OCR_IMPORT_CONFIG = {
    /** 目标渲染页宽（px）；scale = clamp(目标 / 页宽用户单位, min, max)。
     * 实测 1447px 扫描原图数字约 15px，Tesseract 最佳识别点 ~30px，
     * 故需 scale≈4.9（2800/595）才够。 */
    renderScaleTarget: 2800,
    renderScaleMin: 1.5,
    renderScaleMax: 5,
    /** 像素视为「暗」的亮度上限（0-255） */
    darkLumaThreshold: 140,
    /** 一行暗像素占比 ≥ 此值 → 谱线行 */
    lineRatioThreshold: 0.35,
    /** 水平谱线带厚度（px）合理范围 */
    lineBandThicknessPx: [1, 12] as [number, number],
    /** 一列暗像素占比（跨谱高）≥ 此值 → 小节线列。实测 0.6 会把音符符干/杂点当小节线
     *（30 条/谱 → 碎切片空小节），0.8 才是真小节线（5 条/谱），0.9 会漏检。 */
    barlineRatioThreshold: 0.8,
    /** 小节线最小高度（用户空间），更短丢弃 */
    barlineMinHeightUser: 20,
    /** 谱表裁剪外扩（用户空间，保持最小，避免把相邻谱表/标准谱带进来干扰 OCR） */
    cropMarginUser: 4,
    /** 数字置信度下限（0-100） */
    digitConfidenceMin: 45,
    /** 数字 bbox 高度合理范围（用户空间） */
    digitHeightUserRange: [3, 40] as [number, number],
};
