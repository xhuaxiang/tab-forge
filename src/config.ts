/**
 * config — 应用全局默认配置（单一来源）
 *
 * 集中定义乐谱全局默认与 AI 即兴生成配置，页面 UI 与业务逻辑统一从这里读。
 */

import { STANDARD_TUNING, type Tuning, type NoteDuration } from './types/index.ts';

/** 乐谱全局默认（调性 / BPM / 调弦 / 拍号） */
export const SCORE_DEFAULTS = {
    /** 调性 */
    key: 'C',
    /** BPM */
    bpm: 90,
    /** 调弦 */
    tuning: { ...STANDARD_TUNING } as Tuning,
    /** 拍号 */
    timeSignature: '4/4',
};

// ============================================================
// AI 即兴生成配置
// ============================================================

export interface ImprovSelectOption {
    /** 提交给 AI 的值 */
    value: string;
    /** 界面显示标签 */
    label: string;
    /** 注入 prompt 的提示（可选，密度/风格用） */
    hint?: string;
}

export const IMPROV_CONFIG = {
    numMeasures: {
        default: 4,
        min: 3,
        options: [2, 4, 8, 12, 16] as number[],
    },
    scaleTypes: [
        { value: 'Major (Ionian)', label: '大调 (Ionian)' },
        { value: 'Natural Minor (Aeolian)', label: '自然小调 (Aeolian)' },
        { value: 'Harmonic Minor', label: '和声小调' },
        { value: 'Pentatonic Major', label: '大调五声音阶' },
        { value: 'Pentatonic Minor', label: '小调五声音阶' },
        { value: 'Blues', label: '布鲁斯音阶' },
        { value: 'Dorian', label: 'Dorian' },
        { value: 'Mixolydian', label: 'Mixolydian' },
    ] as ImprovSelectOption[],
    styles: [
        { value: 'Jazz', label: '爵士', hint: '摇摆感：八分音符为主，加入切分和"长-短-短"型节奏，和弦音与经过音交替。' },
        { value: 'Blues', label: '布鲁斯', hint: '布鲁斯感：三连音律动，大量 bent/slide 味道的邻音游移，呼应式短句。' },
        { value: 'Rock', label: '摇滚', hint: '摇滚感：强拍强调，八分/十六分驱动，riff 式重复动机+变奏。' },
        { value: 'Folk', label: '民谣', hint: '民谣感：律动平稳，四分/八分为主，旋律歌唱性强，多用双音与和弦琶音。' },
        { value: 'Classical', label: '古典', hint: '古典感：均匀流畅，琶音与音阶跑动，强弱起伏，乐句规整。' },
    ] as ImprovSelectOption[],
    densities: [
        { value: '低', label: '低（长音居多）', hint: '以长音为主：二分(0.5)和四分(0.25)占多数，每小节 2-4 个音，偶尔用八分(0.125)加花，休止符要多。' },
        { value: '中', label: '中', hint: '以四分(0.25)和八分(0.125)为主体，穿插少量十六分(0.0625)作为装饰音，每小节 4-6 个音，节奏有松有紧。' },
        { value: '高', label: '高（快速乐句）', hint: '以八分(0.125)和十六分(0.0625)为主，十六分跑动形成快速乐句，乐句尾用长音(0.25或0.5)收束，密度大但要有呼吸。' },
    ] as ImprovSelectOption[],
};

/** 取某个选项列表里指定 value 的提示 */
export function getHint(options: ImprovSelectOption[], value: string): string | undefined {
    return options.find(o => o.value === value)?.hint;
}

// ============================================================
// PDF 导入解析配置
// ============================================================

/**
 * PDF 导入解析的几何/节奏阈值（初版粗略值，待真实样本 PDF 提供后调优）。
 * 所有数值都在 PDF 用户空间坐标系下（y 轴向上）。
 */
export const PDF_IMPORT_CONFIG: {
    /** 小于此长度的水平/垂直线段忽略 */
    minLineLen: number;
    /** 六线谱候选谱线至少这么宽 */
    staffMinWidth: number;
    /** 相邻谱线间距合理范围 [min, max] */
    lineSpacing: [number, number];
    /** 同一谱线的 y 聚类容差 */
    yClusterTol: number;
    /** 同一直线的 x 片段合并间隔 */
    xMergeGap: number;
    /** 竖线聚成小节线（barline）的 x 容差 */
    barlineXTol: number;
    /** 音符归属小节的边缘容差 */
    measureEdgeTol: number;
    /** 同一拍（x 近等）的和弦分组容差 */
    chordXTol: number;
    /** 文本基线 → 字形垂直中心系数（PDF y 向上，字形中心 = 基线 + 系数×字高） */
    textBaselineToCenter: number;
    /** 同弦相邻数字项合并为两位数的间距系数（× 字高） */
    numMergeGap: number;
    /** 技法标记命中最近音符的 x 容差（× 字高） */
    techTol: number;
    /** 无法推断时值时的兜底（四分音符） */
    defaultDuration: NoteDuration;
    /** 合法幂时值（与 NoteDuration 一致，dur×4 = 拍数） */
    durations: NoteDuration[];
} = {
    minLineLen: 30,
    staffMinWidth: 100,
    lineSpacing: [4, 40],
    yClusterTol: 2,
    xMergeGap: 5,
    barlineXTol: 3,
    measureEdgeTol: 5,
    // OCR 数字位置有噪声，和弦分组容差取 8；小节内相邻拍间距通常 ≥25 不会误合并
    chordXTol: 8,
    textBaselineToCenter: 0.4,
    numMergeGap: 0.7,
    techTol: 2.0,
    defaultDuration: 0.25,
    durations: [1, 0.5, 0.25, 0.125, 0.0625, 0.03125],
};
