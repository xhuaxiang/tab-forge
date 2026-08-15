/**
 * responseParser — 解析并校验 DeepSeek AI 返回的 JSON
 *
 * 将 AI 输出的 { measures: [{ notes: [...] }] } 转为合法的 Note[]。
 * 对每个音符做边界校验，过滤非法值以免污染 scoreStore。
 */

import type { Note, NoteDuration } from '../types/index.ts';

/** AI 返回的原始音符结构 */
interface RawNote {
    string?: number;
    fret?: number;
    duration?: number;
    isRest?: boolean;
    technique?: 'hammerOn' | 'pullOff' | 'slide' | null;
    targetFret?: number;
    tieToNext?: boolean;
    chordGroup?: number;
    arpeggio?: 'up' | 'down' | null;
    strum?: 'up' | 'down' | null;
}

interface RawMeasure {
    notes?: RawNote[];
}

interface RawResponse {
    measures?: RawMeasure[];
}

/** 合法的时值集合 */
const VALID_DURATIONS = new Set([1, 0.5, 0.25, 0.125, 0.0625, 0.03125]);

/** 规范化时值为最近的有效枚举值 */
function clampDuration(d: number | undefined): NoteDuration {
    if (!d || !VALID_DURATIONS.has(d)) {
        const arr = [1, 0.5, 0.25, 0.125, 0.0625, 0.03125];
        const closest = arr.reduce((prev, curr) =>
            Math.abs(curr - (d ?? 0.25)) < Math.abs(prev - (d ?? 0.25)) ? curr : prev
        );
        return closest as NoteDuration;
    }
    return d as NoteDuration;
}

/** 校验单个音符 */
function sanitizeNote(raw: RawNote): Note | null {
    // 休止符只需 duration
    if (raw.isRest) {
        return {
            isRest: true,
            duration: clampDuration(raw.duration),
        };
    }

    const string = raw.string ?? 1;
    if (string < 1 || string > 6) return null;

    const fret = raw.fret ?? 0;
    if (fret < 0 || fret > 24) return null;

    const duration = clampDuration(raw.duration);

    const note: Note = { string, fret, duration };

    if (raw.isRest) note.isRest = true;
    if (raw.tieToNext) note.tieToNext = true;
    if (raw.technique && ['hammerOn', 'pullOff', 'slide'].includes(raw.technique)) {
        note.technique = raw.technique;
        if (raw.targetFret !== undefined && raw.targetFret >= 0 && raw.targetFret <= 24) {
            note.targetFret = raw.targetFret;
        }
    }
    if (raw.chordGroup !== undefined) note.chordGroup = raw.chordGroup;
    if (raw.chordGroup !== undefined && (raw.arpeggio === 'up' || raw.arpeggio === 'down')) {
        note.arpeggio = raw.arpeggio;
    }
    if (raw.chordGroup !== undefined && (raw.strum === 'up' || raw.strum === 'down')) {
        note.strum = raw.strum;
    }

    return note;
}

/**
 * 解析 AI 返回的完整响应
 * @returns 解析后的 Note[] 或错误信息
 */
export function parseAIResponse(rawText: string): { notes: Note[]; error?: string } {
    try {
        // 尝试提取 JSON（AI 可能包在 markdown 代码块中）
        let jsonText = rawText.trim();

        // 去掉可能的 markdown 包裹
        const codeBlockMatch = jsonText.match(/(?:```json\s*)?([\s\S]*?)(?:```)?$/);
        if (codeBlockMatch) {
            jsonText = codeBlockMatch[1].trim();
        }

        // 尝试找到 JSON 对象边界
        const objStart = jsonText.indexOf('{');
        const objEnd = jsonText.lastIndexOf('}');
        if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
            jsonText = jsonText.substring(objStart, objEnd + 1);
        }

        const parsed: RawResponse = JSON.parse(jsonText);

        if (!parsed.measures || !Array.isArray(parsed.measures)) {
            return { notes: [], error: 'AI 返回的 JSON 中缺少 measures 数组' };
        }

        const allNotes: Note[] = [];
        for (const measure of parsed.measures) {
            if (!measure.notes || !Array.isArray(measure.notes)) continue;
            for (const rawNote of measure.notes) {
                const note = sanitizeNote(rawNote);
                if (note) allNotes.push(note);
            }
        }

        if (allNotes.length === 0) {
            return { notes: [], error: 'AI 返回的 measures 中没有有效音符' };
        }

        return { notes: allNotes };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'JSON 解析失败';
        return { notes: [], error: `AI 响应解析错误: ${msg}` };
    }
}