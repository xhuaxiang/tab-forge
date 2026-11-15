/**
 * 音高/音名/频率数据表与换算。
 *
 * 这些是纯数据与纯函数；`getNoteFromFret` / `getNoteFrequency` 暂随数据表
 * 留在这里（历史上就在 types 内），后续若要迁去 `core/utils/` 应单独做。
 */

import type { Tuning } from '../tuning/index.ts';

/**
 * 音符音频频率 (A4 = 440Hz)
 * 用于音频回放
 */
export const NOTE_FREQUENCIES: Record<string, number> = {
    'C0': 16.35, 'C#0': 17.32, 'D0': 18.35, 'D#0': 19.45,
    'E0': 20.60, 'F0': 21.83, 'F#0': 23.12, 'G0': 24.50,
    'G#0': 25.96, 'A0': 27.50, 'A#0': 29.14, 'B0': 30.87,
    'C1': 32.70, 'C#1': 34.65, 'D1': 36.71, 'D#1': 38.89,
    'E1': 41.20, 'F1': 43.65, 'F#1': 46.25, 'G1': 49.00,
    'G#1': 51.91, 'A1': 55.00, 'A#1': 58.27, 'B1': 61.74,
    'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78,
    'E2': 82.41, 'F2': 87.31, 'F#2': 92.50, 'G2': 98.00,
    'G#2': 103.83, 'A2': 110.00, 'A#2': 116.54, 'B2': 123.47,
    'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56,
    'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00,
    'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
    'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13,
    'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00,
    'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
    'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25,
    'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99,
    'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77,
    'C6': 1046.50, 'C#6': 1108.73, 'D6': 1174.66, 'D#6': 1244.51,
    'E6': 1318.51, 'F6': 1396.91, 'F#6': 1479.98, 'G6': 1567.98,
    'G#6': 1661.22, 'A6': 1760.00, 'A#6': 1864.66, 'B6': 1975.53,
    'C7': 2093.00, 'C#7': 2217.46, 'D7': 2349.32, 'D#7': 2489.02,
    'E7': 2637.02, 'F7': 2793.83, 'F#7': 2959.96, 'G7': 3135.96,
    'G#7': 3322.44, 'A7': 3520.00, 'A#7': 3729.31, 'B7': 3951.07,
};

/**
 * 自然音名 → 半音号（C=0 … B=11）。
 *
 * 「音名 ↔ 半音」这个事实的**唯一来源**：`SEMITONE_BY_NOTE_NAME` 由它展开，
 * `core/utils/scoreMapping.ts` 的 `noteNameToMidi` 也查这张表，别再各写一份。
 */
export const NATURAL_SEMITONE: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** 音名（含等音拼写，如 Db / C#）→ 半音号 0-11 */
export const SEMITONE_BY_NOTE_NAME: Record<string, number> = {
    ...NATURAL_SEMITONE,
    'C#': 1, Db: 1, 'D#': 3, Eb: 3, 'F#': 6, Gb: 6,
    'G#': 8, Ab: 8, 'A#': 10, Bb: 10,
};

/** 半音号 0-11 → 音名（统一用升号拼写，下标即半音号） */
export const NOTE_NAMES_SHARP = [
    'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

/** 标准六线谱的弦名称映射 (1弦~6弦) */
export const STRING_NAMES: Record<number, string> = {
    1: 'e',   // 高音E
    2: 'B',
    3: 'G',
    4: 'D',
    5: 'A',
    6: 'E',   // 低音E
};

/**
 * 根据调弦和品位获取音符名称
 * 例如: 标准调弦 1弦0品 => 'E4'
 */
export function getNoteFromFret(tuning: Tuning, stringNum: number, fret: number): string {
    const tuningMap: Record<number, string> = {
        1: tuning.string1,
        2: tuning.string2,
        3: tuning.string3,
        4: tuning.string4,
        5: tuning.string5,
        6: tuning.string6,
    };

    const baseNote = tuningMap[stringNum];
    if (!baseNote) return '';

    // 解析音名和八度
    const match = baseNote.match(/^([A-G][#b]?)(\d+)$/);
    if (!match) return '';

    const noteName = match[1];
    const octave = parseInt(match[2]);

    const noteIndex = SEMITONE_BY_NOTE_NAME[noteName];
    if (noteIndex === undefined) return '';

    // 计算新音符
    const newIndex = noteIndex + fret;
    const newOctave = octave + Math.floor(newIndex / 12);
    const semitone = newIndex % 12;

    return `${NOTE_NAMES_SHARP[semitone]}${newOctave}`;
}

/**
 * 获取音符的频率
 */
export function getNoteFrequency(noteName: string): number {
    return NOTE_FREQUENCIES[noteName] || 0;
}
