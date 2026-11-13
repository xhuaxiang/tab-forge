/**
 * 密度、乐句与风格参数。
 */

import type { NoteDuration } from '../note.ts';
import type { MelodicContour } from './plan.ts';

/** 时值权重（用于加权随机选择） */
export interface DurationWeight {
    duration: NoteDuration;
    weight: number;
}

/** 密度参数：只决定音符疏密与休止比例，不描述风格 */
export interface DensityProfile {
    durations: readonly DurationWeight[];
    /** 每个拍位成为休止的概率（每小节第一个拍位强制为音符） */
    restProbability: number;
    /** 每小节至少保留的发音数 */
    minNotesPerMeasure: number;
}

/** 乐句参数：句长、轮廓、换把与句尾呼吸 */
export interface PhraseProfile {
    /** 每句小节数（通常 2） */
    measures: number;
    /** 轮廓循环顺序；statement 必用第一个 */
    contours: readonly MelodicContour[];
    /** 非末句句尾留休止的概率 */
    endRestProbability: number;
    /**
     * 全曲末音（终止音）的最短时值。
     *
     * 以音符时值而不是秒表示，换 BPM 不会改变乐句形态。延长只从末音之后
     * 的休止和前缀拍位的时值里借，不删除发音拍位，因此每小节发音数与密度
     * 下限不变。终止式只加长或等长后移，不缩短已有末音；小节容量或密度
     * 下限不允许时按能借到的时值加长，否则保留原末音（例如 2/4 只有 0.5
     * 容量、又至少两个发音时，占满整小节的终止音不可达）。
     */
    cadenceMinDuration: NoteDuration;
    /** 句间换把概率（answer/development 用高把位窗口） */
    shiftProbability: number;
    /** 换把幅度（品），当前用于句首模进/窗口选择 */
    shiftFrets: number;
}

/** 风格参数：全部是机器可读的数字，不是 AI prompt 文案 */
export interface StyleProfile {
    /** 风格偏好的时值权重，与密度权重共同决定节奏 */
    durations: readonly DurationWeight[];
    /** 偏好把位（品位，含端点） */
    preferredFretMin: number;
    preferredFretMax: number;
    /** 旋律中心音高（MIDI） */
    registerCenterMidi: number;
    /** 旋律围绕中心音的音域宽度（半音） */
    registerRangeSemitones: number;
    /** 单步最大音程（半音） */
    maxLeapSemitones: number;
    /** 动机长度（音数） */
    motifLength: number;
    /** 重复已有动机的概率 */
    repetitionProbability: number;
    /** 强拍重音概率 */
    accentProbability: number;
    /** 弱拍轻音概率 */
    softProbability: number;
    /** 推弦概率（仅 Blues/Jazz/Rock 非零） */
    bendProbability: number;
    /** 揉弦概率 */
    vibratoProbability: number;
    /** 手掌闷音概率（仅低音弦） */
    palmMuteProbability: number;
    /** 同弦相邻音做击/勾弦的概率（1-2 品） */
    hammerPullProbability: number;
    /** 同弦移动做滑弦的概率（含 1-2 品短滑；两端都不能是空弦） */
    slideProbability: number;
    /** 单音制音概率（仅低音弦、非收尾音） */
    deadNoteProbability: number;
    /** 单音断音概率 */
    staccatoProbability: number;
    /** 单音自由延音概率 */
    letRingProbability: number;
    /** 单音泛音概率（自然/人工/捏弦按可用性选择） */
    harmonicProbability: number;
    /** 泛音命中后优先做自然泛音的条件概率（可用时） */
    naturalHarmonicShare: number;
    /** 未成自然泛音时做捏弦泛音的条件概率（可用时），其余为人工泛音 */
    pinchHarmonicShare: number;
    /** 给旋律拍位加和弦音的概率（仅强拍/句尾/长时值） */
    chordProbability: number;
    /** 和弦拍位追加第二个下方声部的概率 */
    secondVoicingProbability: number;
    /** 和弦组做琶音的概率（仅组首） */
    arpeggioProbability: number;
    /** 和弦组做扫弦的概率（仅组首，优先于琶音） */
    strumProbability: number;
    /** 乐句结构参数 */
    phrase: PhraseProfile;
}
