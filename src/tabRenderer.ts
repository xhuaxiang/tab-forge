/**
 * TabRenderer - 吉他六线谱渲染引擎
 * 负责将 TabScore 数据渲染为 ASCII 风格的六线谱
 */

import type { TabScore, Measure, Note } from './types/index.ts';
import { STRING_NAMES } from './types/index.ts';
import { forEachSlot } from './utils/measureUtils.ts';

/** 渲染选项 */
export interface RenderOptions {
    /** 显示小节编号 */
    showMeasureNumbers: boolean;
    /** 显示调弦信息 */
    showTuning: boolean;
    /** 高亮当前播放位置 */
    highlightPosition: number | null;
}

const DEFAULT_OPTIONS: RenderOptions = {
    showMeasureNumbers: true,
    showTuning: true,
    highlightPosition: null,
};

/**
 * 将乐谱渲染为 HTML 六线谱
 */
export function renderTabToHTML(
    score: TabScore,
    options: Partial<RenderOptions> = {},
): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { measures, tuning } = score;

    if (measures.length === 0) {
        return '<div style="color: #555; text-align: center; padding: 80px 0;">暂无内容 — 点击「添加小节」开始</div>';
    }

    // 构建6行谱线
    const lines: string[] = ['', '', '', '', '', '']; // 6 strings

    // 每行添加谱线开头
    for (let s = 0; s < 6; s++) {
        const stringNum = s + 1;
        const label = STRING_NAMES[stringNum];
        const cls = `tab-string-${stringNum}`;
        lines[s] = `<span class="tab-string-label ${cls}">${label}|</span>`;
    }

    // 遍历每个小节
    for (let m = 0; m < measures.length; m++) {
        const measure = measures[m];

        // 构建拍位列表（按添加顺序，和弦组自动合并）
        interface SlotRenderEntry { notes: (Note | null)[]; }

        const slots: SlotRenderEntry[] = [];

        forEachSlot(measure, (notes) => {
            const slotNotes: (Note | null)[] = [null, null, null, null, null, null];
            for (const n of notes) {
                if (n.string) slotNotes[n.string - 1] = n;
            }
            slots.push({ notes: slotNotes });
        });

        // 确保至少有一个空 slot
        if (slots.length === 0) {
            const emptyNotes: (Note | null)[] = [null, null, null, null, null, null];
            slots.push({ notes: emptyNotes });
        }

        // 渲染每个 slot
        for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
            // 小节线
            if (slotIdx === 0 && m > 0) {
                for (let s = 0; s < 6; s++) {
                    lines[s] += `<span class="tab-barline">|</span>`;
                }
            }

            for (let s = 0; s < 6; s++) {
                const note = slots[slotIdx].notes[s];
                if (note) {
                    const isHighlighted = false;
                    const hl = isHighlighted ? ' highlight' : '';
                    const fretStr = (note.fret ?? 0).toString().padStart(2, ' ');
                    lines[s] += `<span class="tab-note${hl}">${fretStr}</span>`;
                } else {
                    lines[s] += `<span class="tab-note">--</span>`;
                }
            }
        }

        // 小节结束线
        for (let s = 0; s < 6; s++) {
            lines[s] += `<span class="tab-barline">|</span>`;
        }
    }

    // 组装HTML
    let html = '';

    // 调弦信息
    if (opts.showTuning) {
        html += `<div style="font-size: 11px; color: #666; margin-bottom: 8px; display: flex; gap: 12px;">
            <span>调弦: ${tuning.string6} ${tuning.string5} ${tuning.string4} ${tuning.string3} ${tuning.string2} ${tuning.string1}</span>
            <span>BPM: ${score.bpm}</span>
        </div>`;
    }

    // 谱线
    html += '<div class="tab-score">';
    for (let s = 0; s < 6; s++) {
        html += `<div class="tab-line">${lines[s]}</div>`;
    }
    html += '</div>';

    // 小节编号（底部）
    if (opts.showMeasureNumbers) {
        html += '<div style="display: flex; gap: 16px; margin-top: 8px; font-size: 10px; color: #555;">';
        for (let m = 0; m < measures.length; m++) {
            html += `<span>小节 ${m + 1}</span>`;
        }
        html += '</div>';
    }

    return html;
}

/**
 * 创建空白小节
 */
export function createEmptyMeasure(index: number): Measure {
    return {
        index,
        notes: [],
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    };
}

/**
 * 渲染单个音符的文本表示 (用于调试/导出)
 */
export function noteToString(note: Note): string {
    return `${note.string}/${note.fret}`;
}

/**
 * 将乐谱导出为纯文本 ASCII tab 格式
 */
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
        // 构建拍位队列（和弦组自动合并）
        interface SlotExportEntry { frets: (number | null)[]; }

        const slots: SlotExportEntry[] = [];

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

        // 渲染每个拍位到各弦
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

    // 输出
    const stringNames = ['e', 'B', 'G', 'D', 'A', 'E'];
    for (let s = 0; s < 6; s++) {
        lines.push(`${stringNames[s]}|${stringLines[s].join('-')}|`);
    }

    lines.push('');
    return lines.join('\n');
}

/**
 * 将乐谱导出为 JSON 格式
 */
export function exportToJson(score: TabScore): string {
    return JSON.stringify(score, null, 2);
}
