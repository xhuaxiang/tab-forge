/**
 * responseParser — 解析并校验 DeepSeek AI 返回的 JSON
 *
 * 将 AI 输出的 { measures: [{ notes: [...] }] } 转为合法的 Note[]。
 * 对每个音符做边界校验，过滤非法值以免污染 scoreStore。
 */

import type { Note, NoteDuration, AppHarmonic } from '../../core/types/index.ts';
import { NOTE_DURATIONS, APP_HARMONICS } from '../../core/types/index.ts';
import { DEFAULT_HARMONIC_FRET, HARMONIC_FRET_MIN, HARMONIC_FRET_MAX } from '../../core/config.ts';
import { normalizeHarmonicFret } from '../../core/utils/scoreMapping.ts';

/** AI 返回的原始音符结构（来自 JSON.parse，取值一律按不可信处理） */
interface RawNote {
    string?: number;
    fret?: number;
    duration?: number;
    isRest?: boolean;
    /** 合法取值见 AI_TECHNIQUES；来自 AI 输出，故按 string 校验而非直接信联合类型 */
    technique?: string | null;
    targetFret?: number;
    /** 推弦幅度（半音），仅 technique='bend' 时用 */
    bendAmount?: number;
    /** 推弦后是否释放，仅 technique='bend' 时用 */
    bendRelease?: boolean;
    /** 力度，合法取值见 VALID_DYNAMICS */
    dynamics?: string | null;
    palmMute?: boolean;
    deadNote?: boolean;
    letRing?: boolean;
    staccato?: boolean;
    /** 泛音类型，合法取值见 APP_HARMONICS（来自 AI 输出，按 string 校验） */
    harmonic?: string | null;
    /** 人工/捏弦泛音的触弦点（品位差） */
    harmonicFret?: number;
    tieToNext?: boolean;
    chordGroup?: number;
    arpeggio?: 'up' | 'down' | null;
    strum?: 'up' | 'down' | null;
}

interface RawMeasure {
    notes?: RawNote[];
}

/**
 * 编译期护栏：`RawNote` 的字段必须都是 `Note` 也有的字段。
 *
 * 两份清单要手工同步，容易漂（`bendAmount` / `bendRelease` 就曾在 Note 里有、
 * RawNote 里没有 → AI 发了也落不了地，且不报错）。`Note` 一旦改名或删字段，
 * 这里直接编译失败，比运行时静默丢字段好。
 *
 * ⚠️ 反向不成立、也不该成立：`Note.chordName` 是 UI/派生字段，AI 不写；
 * 且 RawNote 的类型刻意比 Note 宽松（不可信输入），所以**不能合并成一个类型**。
 */
type _AssertTrue<T extends true> = T;
export type _RawNoteFieldsAreNoteFields = _AssertTrue<keyof RawNote extends keyof Note ? true : false>;

interface RawResponse {
    measures?: RawMeasure[];
}

/** 合法的时值集合（来源：core/types 的 NOTE_DURATIONS，别在此另写一份） */
const VALID_DURATIONS = new Set<number>(NOTE_DURATIONS);

/**
 * AI 允许输出的技法 —— 必须与 noteContract.ts 中 `technique` 的取值保持一致。
 *
 * 这是 `Note.technique` 的全集（core/types/index.ts）：五种都给 AI。
 * bend / vibrato 是 blues、jazz 味道的主要载体（推弦哭腔、揉弦呼吸），
 * 早先只开放三种时，那两种风格无论提示词怎么写都出不来。
 * ⚠️ 往 noteContract.ts 加技法时务必同步这一行，否则 AI 发来的技法会落不进去。
 */
const AI_TECHNIQUES = ['hammerOn', 'pullOff', 'slide', 'bend', 'vibrato'] as const;
type AITechnique = (typeof AI_TECHNIQUES)[number];

function isAITechnique(t: string): t is AITechnique {
    return (AI_TECHNIQUES as readonly string[]).includes(t);
}

/** AI 允许输出的力度取值（`Note.dynamics` 的全集） */
const VALID_DYNAMICS = ['soft', 'accent'] as const;
type AIDynamics = (typeof VALID_DYNAMICS)[number];

/** 合法的推弦幅度（半音）：1/4 音、1/2 音、全音 */
const VALID_BEND_AMOUNTS = [0.25, 0.5, 1];

function isAIDynamics(v: string): v is AIDynamics {
    return (VALID_DYNAMICS as readonly string[]).includes(v);
}

/** 泛音白名单直接取 core/types 的 APP_HARMONICS，避免与契约各写一份 */
function isAIHarmonic(v: string): v is AppHarmonic {
    return (APP_HARMONICS as readonly string[]).includes(v);
}

/** 规范化时值为最近的有效枚举值 */
function clampDuration(d: number | undefined): NoteDuration {
    if (!d || !VALID_DURATIONS.has(d)) {
        const arr = NOTE_DURATIONS;
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

    if (raw.tieToNext) note.tieToNext = true;
    if (raw.dynamics && isAIDynamics(raw.dynamics)) {
        note.dynamics = raw.dynamics;
    }
    if (raw.technique) {
        if (isAITechnique(raw.technique)) {
            note.technique = raw.technique;
            if (raw.targetFret !== undefined && raw.targetFret >= 0 && raw.targetFret <= 24) {
                note.targetFret = raw.targetFret;
            }
            // 推弦幅度/释放只对 bend 有意义：非法幅度回落到全音，避免画出一条无意义的曲线
            if (raw.technique === 'bend') {
                const amount = raw.bendAmount;
                note.bendAmount = (typeof amount === 'number' && VALID_BEND_AMOUNTS.includes(amount))
                    ? amount
                    : 1;
                if (raw.bendRelease) note.bendRelease = true;
            }
        } else {
            // 契约漂移的显式信号：AI 发了 noteContract 未暴露的技法（很可能是漏扩白名单）。
            // 丢弃技法但保留音符本身，并留下可排查的痕迹，而不是静默吞掉。
            console.warn(
                `[TabForge] responseParser: 未知技法 "${raw.technique}"，已忽略该技法（核对 noteContract.ts 与 AI_TECHNIQUES 是否同步）`
            );
        }
    }
    if (raw.palmMute) note.palmMute = true;
    if (raw.deadNote) note.deadNote = true;
    if (raw.letRing) note.letRing = true;
    if (raw.staccato) note.staccato = true;

    if (raw.harmonic) {
        if (!isAIHarmonic(raw.harmonic)) {
            // 与技法白名单同样的漂移信号：契约里写了、解析器没认，音符会静默少一个泛音
            console.warn(
                `[TabForge] responseParser: 未知泛音类型 "${raw.harmonic}"，已忽略（核对 noteContract.ts 与 APP_HARMONICS）`
            );
        } else if (note.deadNote) {
            // 契约声明两者互斥；制音优先，保留可听见的打击音
            console.warn('[TabForge] responseParser: deadNote 与 harmonic 同时出现，已忽略泛音');
        } else {
            note.harmonic = raw.harmonic;
            if (raw.harmonic !== 'natural') {
                const fret = raw.harmonicFret;
                const valid = typeof fret === 'number' && Number.isInteger(fret)
                    && fret >= HARMONIC_FRET_MIN && fret <= HARMONIC_FRET_MAX;
                // 表外节点（6/11/13…）alphaTab 会按 12 品发声；这里先把存值规范到同一结果，
                // 否则存的值、谱面、回填值三者不一致（用户填 6，点回来变 12）。
                const canonical = normalizeHarmonicFret(valid ? fret : DEFAULT_HARMONIC_FRET);
                if (valid && canonical !== fret) {
                    console.warn(`[TabForge] responseParser: ${fret} 品不是有效泛音节点，已按 ${canonical} 品发声`);
                }
                note.harmonicFret = canonical;
            }
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