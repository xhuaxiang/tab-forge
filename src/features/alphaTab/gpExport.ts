/**
 * gpExport — 导出 Guitar Pro 7+（.gp）文件（无 DOM，可单测）
 *
 * 复用 scoreAdapter 的 TabScore → alphaTab Score 映射，再交给 alphaTab
 * 自带的 Gp7Exporter 序列化。输出为二进制 zip 流，下载动作由 app/ 负责。
 */

import * as alphaTab from '@coderline/alphatab';
import type { TabScore } from '../../core/types/index.ts';
import { tabScoreToAlphaTabScore } from './scoreAdapter.ts';

/** 文件名非法字符（路径分隔符、Windows 保留字符、控制字符） */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** scoreStore 的默认标题占位符，导出时视同空标题 */
const EMPTY_TITLE_PLACEHOLDER = '--';

/** 文件名主干长度上限，防止超长标题在不同文件系统上失败 */
const MAX_FILENAME_BASE_LENGTH = 80;

/** 导出文件名：`标题 - 艺术家.gp`；非法字符替换为 '-'，空标题回落到 'tab-score' */
export function gpExportFileName(score: { title?: string; artist?: string }): string {
    const title = (score.title ?? '').trim();
    const base = [title === EMPTY_TITLE_PLACEHOLDER ? '' : title, score.artist]
        .map(part => (part ?? '').trim())
        .filter(part => part !== '')
        .join(' - ')
        .replace(INVALID_FILENAME_CHARS, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_FILENAME_BASE_LENGTH)
        .trim();
    return `${base || 'tab-score'}.gp`;
}

/** 把乐谱序列化为 Guitar Pro 7+ 二进制（.gp）；空谱也会生成一个全休止小节 */
export function exportToGp(score: TabScore): Uint8Array {
    return new alphaTab.exporter.Gp7Exporter().export(tabScoreToAlphaTabScore(score));
}
