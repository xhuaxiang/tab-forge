/**
 * ocr — OCR 回退分区入口（扫描/图片 PDF）
 */

export { parsePdfOcr } from './parsePdfOcr.ts';
export { detectStaffLines, type PixelToUserMapper } from './staffDetector.ts';
export { OCR_IMPORT_CONFIG } from './ocrConfig.ts';
