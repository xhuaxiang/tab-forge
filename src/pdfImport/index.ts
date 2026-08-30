/**
 * pdfImport — PDF 六线谱导入模块入口
 *
 * - parsePdfFile(arrayBuffer)  解析 PDF 字节 → TabScore（含 pdfjs 懒加载）
 * - parseTabGeometry(geometry) 纯解析：几何 → TabScore（可单测，无需 pdfjs）
 */

export { parsePdfFile, parseTabGeometry } from './parsePdf.ts';
export type { PageGeometry, PlainTextItem, LineSegment, Staff } from './tabGeometry.ts';
