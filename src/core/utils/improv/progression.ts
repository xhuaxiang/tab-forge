/**
 * progression — 和弦进行的解析、规范化与展示（纯函数）。
 *
 * 输入可以混合使用调内级数（`1` / `I` / `ii`）和显式和弦（`C` / `Am` /
 * `F#m7b5`）。这里只负责把文本变成 `ProgressionStep`，级数到实际和弦的
 * 换算仍在 harmony 层完成。
 */

import { NOTE_NAMES_SHARP } from '../../types/index.ts';
import type {
    ChordDegree,
    ChordEvent,
    ChordQuality,
    ChordSpec,
    Progression,
    ProgressionStep,
} from '../../types/improv.ts';
import { CHORD_QUALITIES } from '../../types/improv.ts';
import { capacityFromTimeSignature } from '../measureUtils.ts';
import { noteNameToMidi } from '../scoreMapping.ts';
import { pitchClassOf } from './pitch.ts';

/** 和弦质量白名单（运行时输入校验用） */
export function isChordQuality(value: unknown): value is ChordQuality {
    return typeof value === 'string'
        && (CHORD_QUALITIES as readonly string[]).includes(value);
}

/** 调内级数校验 */
export function isChordDegree(value: unknown): value is ChordDegree {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= 1
        && value <= 7;
}

/** 显式和弦校验 */
export function isChordSpec(value: unknown): value is ChordSpec {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<ChordSpec>;
    return typeof candidate.rootPitchClass === 'number'
        && Number.isInteger(candidate.rootPitchClass)
        && candidate.rootPitchClass >= 0
        && candidate.rootPitchClass <= 11
        && isChordQuality(candidate.quality);
}

/** 进行步骤校验 */
export function isProgressionStep(value: unknown): value is ProgressionStep {
    return isChordDegree(value) || isChordSpec(value);
}

/** 和弦事件校验（只检查字段形态，不检查小节范围） */
export function isChordEvent(value: unknown): value is ChordEvent {
    if (typeof value !== 'object' || value === null) return false;
    const event = value as Partial<ChordEvent>;
    return typeof event.measure === 'number'
        && Number.isInteger(event.measure)
        && typeof event.start === 'number'
        && Number.isFinite(event.start)
        && isProgressionStep(event.chord);
}

function cloneStep(step: ProgressionStep): ProgressionStep {
    return typeof step === 'number' ? step : { ...step };
}

/**
 * 把外部输入收敛成合法进行。
 *
 * 整个数组只要有一项非法就回落到 `[1]`，不做「过滤坏项、保留好项」——
 * 半截进行比明确回落更难排查。返回值是新数组，避免调用方后续修改。
 */
export function normalizeProgression(value: unknown): Progression {
    if (!Array.isArray(value) || value.length === 0) return [1];
    if (!value.every(isProgressionStep)) return [1];
    return value.map(cloneStep);
}

/**
 * 把外部和弦事件收敛成按小节/位置排序的列表。
 *
 * 非法事件被丢弃，不整组回落：事件之间彼此独立，丢一条不应让整张
 * 和弦表消失。越界小节、负数或超过小节容量的 start 都视为非法。
 */
export function normalizeChordChart(
    value: unknown,
    numMeasures: number,
    capacity: number,
): ChordEvent[] {
    if (!Array.isArray(value) || value.length === 0) return [];
    if (!Number.isFinite(capacity) || capacity <= 0) return [];

    const byPosition = new Map<string, ChordEvent>();
    for (const raw of value) {
        if (!isChordEvent(raw)) continue;
        if (raw.measure < 0 || raw.measure >= numMeasures) continue;
        if (raw.start < 0 || raw.start >= capacity) continue;

        const start = Math.min(capacity, Math.max(0, raw.start));
        const key = `${raw.measure}:${Math.round(start * 1e9)}`;
        byPosition.set(key, {
            measure: raw.measure,
            start,
            chord: cloneStep(raw.chord),
        });
    }

    return Array.from(byPosition.values()).sort((a, b) =>
        a.measure - b.measure || a.start - b.start);
}

const ROMAN_DEGREES: Record<ChordDegree, string> = {
    1: 'I',
    2: 'II',
    3: 'III',
    4: 'IV',
    5: 'V',
    6: 'VI',
    7: 'VII',
};

const ROMAN_TO_DEGREE: Record<string, ChordDegree> = {
    I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7,
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7,
};

/** 和弦后缀 → 质量。同时保留大小写敏感项（M7 与 m7 不同）。 */
const CHORD_SUFFIXES: Record<string, ChordQuality> = {
    '': 'major',
    maj: 'major',
    M: 'major',
    m: 'minor',
    min: 'minor',
    dim: 'diminished',
    o: 'diminished',
    '°': 'diminished',
    aug: 'augmented',
    '+': 'augmented',
    maj7: 'major7',
    M7: 'major7',
    'Δ7': 'major7',
    'Δ': 'major7',
    m7: 'minor7',
    min7: 'minor7',
    '7': 'dominant7',
    m7b5: 'halfDiminished7',
    min7b5: 'halfDiminished7',
    'ø7': 'halfDiminished7',
    'ø': 'halfDiminished7',
    dim7: 'diminished7',
    o7: 'diminished7',
    '°7': 'diminished7',
};

const QUALITY_SUFFIXES: Record<ChordQuality, string> = {
    major: '',
    minor: 'm',
    diminished: 'dim',
    augmented: 'aug',
    major7: 'maj7',
    minor7: 'm7',
    dominant7: '7',
    halfDiminished7: 'm7b5',
    diminished7: 'dim7',
};

/**
 * 单个 token → 进行步骤。
 *
 * 优先级：级数（1-7 / I-VII）→ 显式和弦（C / Am / F#m7b5）。
 * 无法识别返回 null，由调用方决定整组回落。
 */
export function parseProgressionToken(token: string): ProgressionStep | null {
    const trimmed = token.trim();
    if (trimmed === '') return null;

    if (/^[1-7]$/.test(trimmed)) {
        return Number(trimmed) as ChordDegree;
    }

    const roman = ROMAN_TO_DEGREE[trimmed];
    if (roman !== undefined) return roman;

    const chord = trimmed.match(/^([A-Ga-g])([#b]?)(.*)$/);
    if (!chord) return null;

    const suffix = chord[3].trim();
    const quality = CHORD_SUFFIXES[suffix]
        ?? CHORD_SUFFIXES[suffix.toLowerCase()];
    if (quality === undefined) return null;

    const letter = chord[1].toUpperCase();
    const accidental = chord[2] ?? '';
    const midi = noteNameToMidi(`${letter}${accidental}4`);
    if (midi <= 0) return null;
    return { rootPitchClass: pitchClassOf(midi), quality };
}

const TOKEN_SEPARATOR = /[\s,;，、|–—\-]+/;

/**
 * 文本 → 和弦进行。
 *
 * 支持 `2-5-1`、`ii–V–I`、`C G Am F`、`| C G | Am F |`（小节线只当分隔符）。
 * 任意一个 token 不合法就整组返回 null，避免半截进行。
 */
export function parseProgressionText(text: string): Progression | null {
    const tokens = text.split(TOKEN_SEPARATOR).filter(token => token.trim() !== '');
    if (tokens.length === 0) return null;

    const steps: ProgressionStep[] = [];
    for (const token of tokens) {
        const step = parseProgressionToken(token);
        if (step === null) return null;
        steps.push(step);
    }
    return steps;
}

/**
 * 带小节线的文本 → 每小节的和弦组。
 *
 * `|` 一律视为小节分隔符（首尾/单边都行，空段忽略）；返回 null 表示
 * 文本不含小节线或任一小节无法解析，调用方应退回 `parseProgressionText`。
 */
export function parseChordChartText(text: string): ProgressionStep[][] | null {
    if (!text.includes('|')) return null;

    const bars = text.split('|')
        .map(part => part.trim())
        .filter(part => part !== '');
    if (bars.length === 0) return null;

    const parsed: ProgressionStep[][] = [];
    for (const bar of bars) {
        const steps = parseProgressionText(bar);
        if (steps === null) return null;
        parsed.push([...steps]);
    }
    return parsed;
}

function chartStart(capacity: number, index: number, count: number): number {
    return capacity * index / Math.max(1, count);
}

/**
 * 每小节和弦组 → 和弦事件。
 *
 * 小节数多于和弦组数时循环使用；少于和弦组数时保留尾部（与
 * `progression` 的收尾规则一致）；最后一小节强制使用最后一组。
 * 每组内部按等分铺开。
 */
export function chordChartFromBars(
    bars: readonly (readonly ProgressionStep[])[],
    numMeasures: number,
    timeSignature: string,
): ChordEvent[] {
    const capacity = capacityFromTimeSignature(timeSignature);
    if (!Number.isFinite(capacity) || capacity <= 0) return [];
    if (bars.length === 0 || numMeasures <= 0) return [];

    const events: ChordEvent[] = [];
    for (let measure = 0; measure < numMeasures; measure++) {
        const bar = measure === numMeasures - 1
            ? bars[bars.length - 1]
            : numMeasures < bars.length
                ? bars[bars.length - numMeasures + measure]
                : bars[measure % bars.length];
        if (bar.length === 0) continue;
        bar.forEach((chord, index) => {
            events.push({
                measure,
                start: chartStart(capacity, index, bar.length),
                chord,
            });
        });
    }
    return events;
}

/**
 * 按「每小节 N 个和弦」把进行等分成和弦事件。
 *
 * 总槽位少于进行长度时取进行收尾（与逐小节铺法一致）；多于进行长度时
 * 循环，并强制最后一个槽位落在进行的最后一步。每小节 1 个和弦时返回
 * 空数组，保持旧的 `progression` 行为（含最后一小节强制收尾）。
 */
export function buildChordChart(
    steps: readonly ProgressionStep[],
    numMeasures: number,
    chordsPerMeasure: number,
    timeSignature: string,
): ChordEvent[] {
    const capacity = capacityFromTimeSignature(timeSignature);
    if (!Number.isFinite(capacity) || capacity <= 0) return [];
    if (steps.length === 0 || numMeasures <= 0) return [];

    const perMeasure = Math.max(1, Math.min(16, Math.round(chordsPerMeasure)));
    if (perMeasure <= 1) return [];

    const totalSlots = numMeasures * perMeasure;
    const count = steps.length;
    const sequence: ProgressionStep[] = totalSlots <= count
        ? steps.slice(count - totalSlots)
        : Array.from({ length: totalSlots }, (_, index) => steps[index % count]);
    if (totalSlots > count) {
        sequence[sequence.length - 1] = steps[count - 1];
    }

    const events: ChordEvent[] = [];
    for (let slot = 0; slot < totalSlots; slot++) {
        events.push({
            measure: Math.floor(slot / perMeasure),
            start: chartStart(capacity, slot % perMeasure, perMeasure),
            chord: sequence[slot],
        });
    }
    return events;
}

/** 和弦符号（根音用升号名，低音区不展开八度） */
export function formatChordSpec(chord: ChordSpec): string {
    return `${NOTE_NAMES_SHARP[chord.rootPitchClass]}${QUALITY_SUFFIXES[chord.quality]}`;
}

/** 单个进行步骤的展示文本 */
export function formatProgressionStep(step: ProgressionStep): string {
    return typeof step === 'number'
        ? ROMAN_DEGREES[step]
        : formatChordSpec(step);
}

/** 进行展示文本，默认用 en dash 连接 */
export function formatProgression(
    progression: readonly ProgressionStep[],
    separator = '–',
): string {
    return progression.map(formatProgressionStep).join(separator);
}

/** 进行深比较：级数按值比较，显式和弦按根音 + 质量比较 */
export function progressionEquals(
    left: readonly ProgressionStep[],
    right: readonly ProgressionStep[],
): boolean {
    if (left.length !== right.length) return false;
    return left.every((step, index) => {
        const other = right[index];
        if (typeof step === 'number' || typeof other === 'number') {
            return step === other;
        }
        return step.rootPitchClass === other.rootPitchClass
            && step.quality === other.quality;
    });
}
