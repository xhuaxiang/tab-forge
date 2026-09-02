/**
 * TabForge 类型定义
 * 吉他六线谱扒谱工具核心数据类型
 */

/** 音符时值枚举 */
export type NoteDuration = 1 | 0.5 | 0.25 | 0.125 | 0.0625 | 0.03125;

/** 音符时值名称映射 */
export const DURATION_NAMES: Record<number, string> = {
    1: '全音符',
    0.5: '二分音符',
    0.25: '四分音符',
    0.125: '八分音符',
    0.0625: '十六分音符',
    0.03125: '三十二分音符',
};

/** 单个音符（某弦某品） */
export interface Note {
    /** 弦号 (1=高音E, 6=低音E) */
    string?: number;
    /** 品位 (0=空弦, 1-24) */
    fret?: number;
    /** 时值（相对值） */
    duration: NoteDuration;
    /** 延音/技法标记（true=标记为延音或技法音符，渲染弧线/技法符号） */
    tieToNext?: boolean;
    /** 演奏技法: hammerOn(击弦), pullOff(勾弦), slide(滑弦), bend(推弦), vibrato(揉弦) */
    technique?: 'hammerOn' | 'pullOff' | 'slide' | 'bend' | 'vibrato';
    /** 技法目标品位（击/勾/滑到达的品位；推弦时表示推弦幅度半音数，1=全音Full） */
    targetFret?: number;
    /** 推弦幅度（半音数）: 0.25=1/4, 0.5=1/2, 1=Full。仅 technique='bend' 时有效 */
    bendAmount?: number;
    /** 推弦后是否释放回来。仅 technique='bend' 时有效 */
    bendRelease?: boolean;
    /** 休止符 */
    isRest?: boolean;
    /** 和弦分组ID：同一和弦内的音符共享相同ID，单音/休止符为undefined */
    chordGroup?: number;
    /** 和弦名称（仅在chordGroup组的第一个音符上记录） */
    chordName?: string;
    /** 琶音方向（仅在chordGroup组的第一个音符上记录） */
    arpeggio?: 'up' | 'down';
    /** 扫弦方向（仅在chordGroup组的第一个音符上记录） */
    strum?: 'up' | 'down';
}

/** 单个小节 */
export interface Measure {
    /** 小节序号 (从0开始) */
    index: number;
    /** 小节内的所有拍位，按添加顺序排列（单音/休止符/和弦音符统一在此） */
    notes: Note[];
    /** 拍号 - 分子 (默认4) */
    timeSignatureNumerator: number;
    /** 拍号 - 分母 (默认4) */
    timeSignatureDenominator: number;
}

/** 调弦配置 (6弦吉他, 从1弦到6弦) */
export interface Tuning {
    /** 1弦 (高音E) */
    string1: string;
    /** 2弦 (B) */
    string2: string;
    /** 3弦 (G) */
    string3: string;
    /** 4弦 (D) */
    string4: string;
    /** 5弦 (A) */
    string5: string;
    /** 6弦 (低音E) */
    string6: string;
}

/** 标准调弦 */
export const STANDARD_TUNING: Tuning = {
    string1: 'E4',
    string2: 'B3',
    string3: 'G3',
    string4: 'D3',
    string5: 'A2',
    string6: 'E2',
};

/** 预设调弦映射 */
export const TUNING_PRESETS: Record<string, Tuning> = {
    standard: { string1: 'E4', string2: 'B3', string3: 'G3', string4: 'D3', string5: 'A2', string6: 'E2' },
    dropD: { string1: 'E4', string2: 'B3', string3: 'G3', string4: 'D3', string5: 'A2', string6: 'D2' },
    openG: { string1: 'D4', string2: 'B3', string3: 'G3', string4: 'D3', string5: 'G2', string6: 'D2' },
    openD: { string1: 'D4', string2: 'A3', string3: 'F#3', string4: 'D3', string5: 'A2', string6: 'D2' },
    halfStepDown: { string1: 'Eb4', string2: 'Bb3', string3: 'Gb3', string4: 'Db3', string5: 'Ab2', string6: 'Eb2' },
    fullStepDown: { string1: 'D4', string2: 'A3', string3: 'F#3', string4: 'D3', string5: 'A2', string6: 'D2' },
};

/** 完整的乐谱 */
export interface TabScore {
    /** 标题 */
    title: string;
    /** 艺术家/来源 */
    artist: string;
    /** 调弦 */
    tuning: Tuning;
    /** BPM */
    bpm: number;
    /** 小节列表 */
    measures: Measure[];
    /** 曲调 (Key) */
    key?: string;
    /** 全局拍号（如 "4/4"），默认 "4/4" */
    timeSignature: string;
    /** 备注 */
    remarks?: string;
}

/** 和弦图 */
export interface ChordDiagram {
    /** 和弦名称 (如 Am, C, G7) */
    name: string;
    /** 各弦按的品位，0=空弦，-1=不弹 */
    frets: number[];
    /** 每根弦用哪根手指按 (1=食指, 2=中指, 3=无名指, 4=小指) */
    fingers: number[];
}

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

    // 半音阶索引映射
    const chromaticScale: Record<string, number> = {
        'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
        'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
        'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
    };

    const noteIndex = chromaticScale[noteName];
    if (noteIndex === undefined) return '';

    // 计算新音符
    const newIndex = noteIndex + fret;
    const newOctave = octave + Math.floor(newIndex / 12);
    const semitone = newIndex % 12;

    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return `${noteNames[semitone]}${newOctave}`;
}

/**
 * 获取音符的频率
 */
export function getNoteFrequency(noteName: string): number {
    return NOTE_FREQUENCIES[noteName] || 0;
}
