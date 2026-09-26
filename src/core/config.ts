/**
 * config — 应用全局默认配置（单一来源）
 *
 * 集中定义乐谱全局默认与 AI 即兴生成配置，页面 UI 与业务逻辑统一从这里读。
 */

import { STANDARD_TUNING, type Tuning } from './types/index.ts';

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
// 渲染 / 播放可调参数
// ============================================================

/** 默认渲染器（RenderMode 的取值之一，见 app/render.ts） */
export const DEFAULT_RENDER_MODE = 'alphaTab';

/** alphaTab 整体显示缩放（含字体），适配紧凑布局 */
export const ALPHATAB_DISPLAY_SCALE = 0.75;

/**
 * 扫弦每弦间隔（毫秒）
 *
 * 渲染侧（alphaTab scoreAdapter）与播放侧（karplus scheduling）共用同一个值，
 * 改这里两边一致——此前两边各写一份 12，靠注释保持同步。
 */
export const STRUM_INTERVAL_MS = 12;

/** 琶音每弦间隔（毫秒），同 {@link STRUM_INTERVAL_MS} */
export const ARPEGGIO_INTERVAL_MS = 40;

/**
 * 推弦幅度档位 → 显示标签（0.25=1/4 音，0.5=1/2 音，1=全音）。
 *
 * canvas 画推弦弧线与状态栏提示共用；新增档位只在这里加。
 */
export const BEND_AMOUNT_LABELS: Record<number, string> = {
    0.25: '1/4',
    0.5: '1/2',
    1: 'Full',
};

// ============================================================
// AI 即兴生成配置
// ============================================================

/** DeepSeek API 调用配置（endpoint / 模型 / 温度 / 最大 token） */
export const DEEPSEEK_CONFIG = {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-v4-flash',
    temperature: 0.8,
    maxTokens: 4096,
};

/** AI 请求超时（毫秒）：兜底，避免无限挂起，超时给出明确错误 */
export const AI_TIMEOUT_MS = 60000;

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
