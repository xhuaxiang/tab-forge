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

/**
 * 播放引擎取值（唯一来源）。
 *
 * 与 index.html 的 `#engineSelect` option value 对应——HTML 改了就静默回落到默认引擎，
 * 所以启动时会自检（见 app/eventHandlers.ts 的 `warnOnDomValueDrift`）。
 */
export const PLAYBACK_ENGINES = ['ks', 'alphatab'] as const;

export type PlaybackEngine = (typeof PLAYBACK_ENGINES)[number];

/** 默认播放引擎：SoundFont（GM 采样，支持推弦/揉弦与力度；合成器是物理合成、无表情） */
export const DEFAULT_PLAYBACK_ENGINE: PlaybackEngine = 'alphatab';

/** 把 DOM 上取到的字符串收敛成 PlaybackEngine（不合法时返回 false，调用方决定回落） */
export function isPlaybackEngine(v: string | null | undefined): v is PlaybackEngine {
    return v != null && (PLAYBACK_ENGINES as readonly string[]).includes(v);
}

/** alphaTab 整体显示缩放（含字体），适配紧凑布局 */
export const ALPHATAB_DISPLAY_SCALE = 0.75;

/**
 * alphaTab 轨道的默认音量（0-16，16=最大）与声像（0-16，8=居中）。
 *
 * 由 scoreAdapter 写进 `PlaybackInformation`，只影响 SoundFont 引擎。
 */
export const ALPHATAB_DEFAULT_VOLUME = 15;
export const ALPHATAB_DEFAULT_BALANCE = 8;

/** 乐谱无标题时的轨道名兜底（alphaTab 轨道/短名） */
export const DEFAULT_TRACK_NAME = 'Guitar';
export const DEFAULT_TRACK_NAME_SHORT = 'G';

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
 * 力度 → 音量系数（Karplus 引擎用；SoundFont 侧走 alphaTab 的 dynamics）。
 *
 * accent 抬、soft 压，差距别太小——1.0 附近听不出重音，律动就没了。
 */
export const DYNAMICS_VOLUME_FACTOR: Record<'soft' | 'accent', number> = {
    soft: 0.65,
    accent: 1.35,
};

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
    // hint 是 prompt 资产：由 buildUserPrompt 注入 user prompt，UI 只读 label（fillSelect），
    // 所以改这里的文案不会影响界面。多行文本用 [].join('\n')，避免手写 \n 转义与模板字符串的缩进污染。
    styles: [
        {
            value: 'Jazz',
            label: '爵士',
            hint: [
                '定位：标准爵士三重奏里的一段独奏，摇摆、留白、语气松弛。',
                '律动与节奏：八分(0.125)与四分(0.25)为主；摇摆感靠"长-短"成对形成（0.25 接 0.125，约 2:1 的听感），并大量切分——让音从弱拍进入、跨过强拍；句尾用 0.5 拉长。本系统不支持三连音，不要写三连音。',
                '旋律与乐句：以三音、七音这类和弦色彩音为骨架，弱拍上填经过音与邻音；动机短小（2-3 个音），靠整体下行模进推进；乐句收在色彩音上，留一点"话没说完"的悬置感，别每次都落回主音。',
                '演奏法：同一根弦上相差 1-2 品的音用 hammerOn / pullOff 做快速装饰（如中高把位 7→5 品 pullOff）；两个乐句之间换把用 slide（如 5→7 品）带出来；**长音加 vibrato 让它有呼吸**，句尾可以用 bend（"bendAmount": 0.5 或 1）推一下再落，这是爵士句尾的常用语气。',
                '力度：爵士的轻重对比很清楚——强拍和句首 accent，弱拍上那些经过音/邻音用 soft；一路平着弹就是练习曲。',
                '反例：不要每拍都塞满八分、音音相连不给休止（那是练习曲）；不要所有乐句都从主音起、都在主音落；不要写成方整的四分音符行进；不要一个揉弦都没有。',
            ].join('\n'),
        },
        {
            value: 'Blues',
            label: '布鲁斯',
            hint: [
                '定位：十二小节布鲁斯里的一段独奏，粗粝、问答式，像人声在喊话。',
                '律动与节奏：八分(0.125)与四分(0.25)为主，摇摆靠"长-短"成对近似——长音给足、短音抢进来；重音落在第 1、3 拍和乐句的第一个音。本系统不支持三连音，不要写三连音。',
                '旋律与乐句：小调五声音阶加 b3 / b5 / b7 的蓝调音，核心是半音邻音反复游移（b3→3、b5→5、b7→7），在同一个位置"蹭"出味道；乐句短，两小节一问、两小节一答，答句常重复问句的句头再换尾。',
                '演奏法：**推弦与揉弦是布鲁斯的灵魂**——b3→3 用 bend（"bendAmount": 1）抹上去，长音挂 vibrato 让它"唱"起来，句尾的推弦可加 "bendRelease": true 推上去再放回来；同一根弦上 3→5、5→6 品这类相邻音用 hammerOn / pullOff 反复游移；把位可在 5-8 品与 12-15 品之间呼应。',
                '力度：问答结构靠力度做出来——问句起音 accent，答句收束音 accent，中间游移的短音压成 soft；全句等响就听不出"喊话"感。',
                '反例：不要整段只是五声音阶上下行（音阶练习的听感）；不要一句推弦/揉弦都没有（那是布鲁斯最刺耳的缺失）；不要每个乐句一样长、都从同一个音起；不要一路均匀八分扫过去，布鲁斯要"拖"。',
            ].join('\n'),
        },
        {
            value: 'Rock',
            label: '摇滚',
            hint: [
                '定位：失真音色下的独奏段落，节奏硬、动机抓耳，冲击力优先。',
                '律动与节奏：八分(0.125)为骨架，第 1、3 拍上的音给足时值、重音明确；弱拍插 0.0625 十六分做冲刺；句末用一个 0.5 或 1 的长音砸下来收束。',
                '旋律与乐句：以五声音阶的三音动机为单位（如 1-b3-4），原样重复两三次后移调或换尾；音区偏高把位（12-17 品）；段落尾部从高把位快速下行回到低音区收束。',
                '演奏法：12-17 品同一根弦上相差 1-2 品的音用 hammerOn / pullOff 连打做跑句；跨把用 slide（如 12→15 品）制造滑入的冲劲；低音弦空弦（6 弦 0 品）可作动机的低音锚点。',
                '反例：不要四小节用同一个节奏型复制粘贴（听感是循环伴奏不是独奏）；不要整段待在 1-5 品慢慢爬；不要句末不给长音，让段落没有落点。',
            ].join('\n'),
        },
        {
            value: 'Folk',
            label: '民谣',
            hint: [
                '定位：木吉他自弹自唱般的间奏，旋律像在唱歌，不炫技。',
                '律动与节奏：四分(0.25)与八分(0.125)为主，律动方整平稳、重音落在每小节第一拍；常用 0.25 + 0.125 + 0.125 的分解型；乐句之间给休止符换气。',
                '旋律与乐句：围绕调内音阶做级进与三度跳进，旋律线长、气息宽，要能唱得出来；动机以两小节为单位成对出现，第二句用第一句的句头、换掉句尾；句尾落在主音或五音上，收得干净。',
                '演奏法：多用双音与和弦琶音——同一 chordGroup 里放 3-4 个音并给 arpeggio；大量用空弦音（0 品）让音色透亮；hammerOn / pullOff 只作轻点，换把用 slide（如 5→7 品）连接两句。',
                '反例：不要连续一串十六分音符平铺（民谣不靠速度）；不要为了炫技让音区乱跳，旋律要唱得出来；不要整段只用单音——双音和琶音是它的底色。',
            ].join('\n'),
        },
        {
            value: 'Classical',
            label: '古典',
            hint: [
                '定位：尼龙弦古典吉他的独奏乐句，工整连贯，用分解和弦与音阶跑动说话，不靠摇摆。',
                '律动与节奏：四分(0.25)与八分(0.125)均匀推进，不做摇摆与切分；十六分(0.0625)用于成串的音阶或分解和弦跑动，跑动前后各用 0.5 长音当框架；乐句按两小节一句规整划分。',
                '旋律与乐句：以三度、六度音程与分解和弦为骨架，音阶跑动要成串（上行级进后下行，或反之），不做没有准备的跳进；乐句走"弱起—展开—落回"的弧线，收在调内稳定音上。',
                '演奏法：低把位 1-7 品的分解和弦与音阶为主，需要变音色时换到 12 品附近；同一根弦相差 1-2 品的音用 hammerOn / pullOff 做圆滑连奏，换把用 slide 且落点要准；低音弦空弦（0 品）作持续音。',
                '反例：不要摇摆、不要切分、不要布鲁斯式的半音游移（那不是这个风格的语言）；不要四小节用同一个节奏型复制粘贴；不要全部停在 1-5 品匀速念经式八分。',
            ].join('\n'),
        },
    ] as ImprovSelectOption[],
    // 密度与风格正交：只描述"音符多密、多长"，不写风格词、把位、技法
    densities: [
        {
            value: '低',
            label: '低（长音居多）',
            hint: [
                '以长音为主：0.5 与 0.25 撑起大部分时值，0.125 只作偶尔的加花。',
                '音符稀疏，一个 4/4 小节里常只有两三个发音，其余用休止符(isRest: true)补齐容量——让每个音都听得清楚。',
                '长音就给足，不要在长音中间插碎音，句子听起来是"唱"而不是"说"。',
            ].join('\n'),
        },
        {
            value: '中',
            label: '中',
            hint: [
                '0.25 与 0.125 交替为主体，0.0625 只作装饰性的快速经过。',
                '发音与休止大致各半，一小节里通常四到六个发音，密度有松有紧。',
                '乐句尾部用一个 0.5 长音收住，句子内部可以密集。',
            ].join('\n'),
        },
        {
            value: '高',
            label: '高（快速乐句）',
            hint: [
                '以 0.125 与 0.0625 为主，成串的十六分跑动构成乐句主体。',
                '一个乐句内部保持同一种密度；跑动之间用 0.25 或 0.5 的长音"落地"，否则听感会糊成一片。',
                '休止符少而关键：放在乐句与乐句之间换气，不要放在句子内部。',
            ].join('\n'),
        },
    ] as ImprovSelectOption[],
};

/** 取某个选项列表里指定 value 的提示 */
export function getHint(options: ImprovSelectOption[], value: string): string | undefined {
    return options.find(o => o.value === value)?.hint;
}
