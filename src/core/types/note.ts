/**
 * 音符时值、奏法与音符数据模型。
 *
 * `NoteBase` 只装所有乐器共有的字段；六线谱特有的 `string` / `fret` /
 * 推弦、泛音、闷音等奏法都留在 `GuitarNote`。`Note` 是 `GuitarNote` 的
 * 兼容别名，现有持久化形状与 AI 契约都以它为准。
 */

/**
 * 合法的音符时值（相对值），由长到短。
 *
 * 这是时值合法集合的**唯一来源**：`NoteDuration` 类型、AI 输出的时值校验都从这里派生，
 * 别再各处内联一份 `[1, 0.5, ...]`。时值的中文名见 `core/utils/duration.ts` 的 `durationName`。
 */
export const NOTE_DURATIONS = [1, 0.5, 0.25, 0.125, 0.0625, 0.03125] as const;

/** 音符时值枚举 */
export type NoteDuration = (typeof NOTE_DURATIONS)[number];

/**
 * 应用支持的泛音类型（P0：自然 / 人工 / 捏弦）。
 *
 * 与 alphaTab 的 `model.HarmonicType` 对应（映射见 core/utils/scoreMapping.ts），
 * 也用作 AI 输出校验的白名单——新增类型只改这里，别在别处再抄一份。
 */
export const APP_HARMONICS = ['natural', 'artificial', 'pinch'] as const;
export type AppHarmonic = (typeof APP_HARMONICS)[number];

/**
 * 可叠加在音符上的奏法开关（与 `technique` 正交，可同时存在）。
 *
 * 这些不是一个「选一个」的技法枚举，而是各自独立的布尔标记：
 * 例如手掌闷音 + 滑弦、断音 + 击弦都可能同时出现。
 */
export const NOTE_ARTICULATIONS = ['palmMute', 'deadNote', 'letRing', 'staccato'] as const;
export type NoteArticulation = (typeof NOTE_ARTICULATIONS)[number];

/**
 * 所有乐器音符共有的字段。
 *
 * 不放 `string` / `fret` / `pitch` 这类发声方式：六线谱用弦品，钢琴用音高，
 * 各自留在子类型里。未来钢琴音符只要求结构上能落到 `Note`，因此这里不要
 * 增加任何乐器专属字段。
 */
export interface NoteBase {
    /** 时值（相对值） */
    duration: NoteDuration;
    /** 延音/技法标记（true=标记为延音或技法音符，渲染弧线/技法符号） */
    tieToNext?: boolean;
    /**
     * 力度：'accent'=重音（强拍/句首，音量上调）、'soft'=轻音（弱拍/经过音，音量下调）。
     * 不写 = 普通力度。播放侧两个引擎都读它（Karplus 调音量、alphaTab 走 dynamics），
     * 这是「律动感」的主要来源——全曲等响听起来就是机械练习。
     */
    dynamics?: 'soft' | 'accent';
    /** 休止符 */
    isRest?: boolean;
    /** 和弦分组ID：同一和弦内的音符共享相同ID，单音/休止符为undefined */
    chordGroup?: number;
    /** 和弦名称（仅在chordGroup组的第一个音符上记录） */
    chordName?: string;
    /** 琶音方向（仅在chordGroup组的第一个音符上记录） */
    arpeggio?: 'up' | 'down';
}

/**
 * 六线谱音符（某弦某品）。
 *
 * `string` / `fret` 保持可选：现有对象字面量与旧存档都依赖这一点，未来
 * 钢琴音符也靠可选性保持结构兼容。不要改成必填。
 */
export interface GuitarNote extends NoteBase {
    /** 弦号 (1=高音E, 6=低音E) */
    string?: number;
    /** 品位 (0=空弦, 1-24) */
    fret?: number;
    /**
     * 演奏技法: hammerOn(击弦), pullOff(勾弦), slide(滑弦), bend(推弦), vibrato(揉弦)。
     * 一次只能选一个；闷音/泛音等见下方独立的奏法开关，可与其叠加。
     */
    technique?: 'hammerOn' | 'pullOff' | 'slide' | 'bend' | 'vibrato';
    /** 技法目标品位（击弦/勾弦/滑弦到达的品位）。推弦幅度不用它，用 bendAmount */
    targetFret?: number;
    /**
     * 推弦幅度，**以全音为单位**：0.25=1/4 全音、0.5=半个全音、1=全音（=2 个半音）。
     * 仅 technique='bend' 时有效。
     * ⚠️ 不是半音数——这里写错会让 AI 把幅度写小一半（alphaTab 侧 ×4 转四分之一音、
     * Karplus 侧 ×2 转半音，都按全音算）。
     */
    bendAmount?: number;
    /** 推弦后是否释放回来。仅 technique='bend' 时有效 */
    bendRelease?: boolean;

    // ---- 奏法开关（与 technique 正交，可叠加） ----

    /** 手掌闷音 (Palm Mute)：低音弦短促、干、有推进感 */
    palmMute?: boolean;
    /** 制音/死音 (Dead Note，谱面记作 X)：有弦号与品位，但发沉闷的打击音 */
    deadNote?: boolean;
    /** 延音 (Let Ring)：不重新拨弦，让当前音继续响 */
    letRing?: boolean;
    /** 断音 (Staccato)：缩短发声时值 */
    staccato?: boolean;
    /** 泛音类型。natural 用 fret 作触弦节点，artificial/pinch 用 harmonicFret */
    harmonic?: AppHarmonic;
    /**
     * 人工/捏弦泛音的触弦点（品位差），常用 5 / 7 / 12，省略按默认 12。
     * natural 忽略此字段（节点就是 fret）。
     */
    harmonicFret?: number;
    /** 扫弦方向（仅在chordGroup组的第一个音符上记录） */
    strum?: 'up' | 'down';
}

/**
 * 兼容别名：当前所有 `Note` 都是六线谱音符。
 *
 * 未来钢琴音符应新增 `PianoNote`，只在需要同时处理两种谱的边界使用
 * `GuitarNote | PianoNote`；不要把这个别名改成联合类型。
 */
export type Note = GuitarNote;

/** 应用层技法：算上「无技法」。`Note.technique` 是它的子集，别再各写一份列表 */
export type AppTechnique = 'none' | NonNullable<Note['technique']>;
