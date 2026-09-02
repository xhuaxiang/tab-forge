/**
 * tabExport — 乐谱导出格式工具（纯函数）
 *
 * exportToAsciiTab — 导出纯文本 ASCII 六线谱
 * exportToJson     — 导出结构化 JSON
 */

import type { TabScore } from '../types/index.ts';
import { forEachSlot } from './measureUtils.ts';

/** 将乐谱导出为纯文本 ASCII tab 格式 */
export function exportToAsciiTab(score: TabScore): string {
    const { measures, tuning, title, artist, bpm } = score;
    const lines: string[] = [];

    // 头部
    lines.push('='.repeat(60));
    lines.push(`  ${title || '-'} ${artist ? `- ${artist}` : ''}`);
    lines.push(`  BPM: ${bpm}  |  Tuning: ${tuning.string6} ${tuning.string5} ${tuning.string4} ${tuning.string3} ${tuning.string2} ${tuning.string1}`);
    lines.push('='.repeat(60));
    lines.push('');

    if (measures.length === 0) {
        lines.push('[Empty]');
        return lines.join('\n');
    }

    // 构建每根弦的字符行
    const stringLines: string[][] = [[], [], [], [], [], []];

    for (const measure of measures) {
        const slots: { frets: (number | null)[] }[] = [];

        forEachSlot(measure, (notes) => {
            const frets: (number | null)[] = [null, null, null, null, null, null];
            for (const n of notes) {
                const idx = (n.string ?? 0) - 1;
                if (idx >= 0 && idx < 6) frets[idx] = n.fret ?? 0;
            }
            slots.push({ frets });
        });

        // 空小节
        if (slots.length === 0) {
            slots.push({ frets: [null, null, null, null, null, null] });
        }

        for (const slot of slots) {
            for (let s = 0; s < 6; s++) {
                const fret = slot.frets[s];
                if (fret !== null) {
                    stringLines[s].push(fret.toString().padStart(2, '0'));
                } else {
                    stringLines[s].push('--');
                }
            }
        }
    }

    const stringNames = ['e', 'B', 'G', 'D', 'A', 'E'];
    for (let s = 0; s < 6; s++) {
        lines.push(`${stringNames[s]}|${stringLines[s].join('-')}|`);
    }

    lines.push('');
    return lines.join('\n');
}

/** 将乐谱导出为 JSON 格式 */
export function exportToJson(score: TabScore): string {
    return JSON.stringify(score, null, 2);
}
