/**
 * 六线谱调弦类型与预设。
 */

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
