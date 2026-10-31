/**
 * description — 本地即兴的自由描述 → 生成选项。
 *
 * 只做关键词匹配，不做语义理解：命中的字段覆盖下拉框，没命中的保持原值。
 * 同一段文字里出现多个同类词时，取文本中最先出现的那个；纯函数，无 DOM。
 */

import type {
    FretRange,
    ImprovOptions,
    LocalDensity,
    LocalStyle,
    Progression,
    ProgressionStep,
    ScaleType,
} from '../../types/improv.ts';
import { LOCAL_IMPROV_CONFIG } from '../../config.ts';
import { parseKey } from './pitch.ts';
import {
    parseProgressionText,
    parseProgressionToken,
} from './progression.ts';

interface Keyword<T> {
    pattern: RegExp;
    value: T;
}

function findFirst<T>(text: string, keywords: readonly Keyword<T>[]): T | undefined {
    let bestIndex = Number.POSITIVE_INFINITY;
    let best: T | undefined;
    for (const keyword of keywords) {
        const match = text.match(keyword.pattern);
        if (match?.index !== undefined && match.index < bestIndex) {
            bestIndex = match.index;
            best = keyword.value;
        }
    }
    return best;
}

const STYLE_KEYWORDS: readonly Keyword<LocalStyle>[] = [
    { pattern: /爵士|jazz/i, value: 'Jazz' },
    { pattern: /布鲁斯|蓝调|blues/i, value: 'Blues' },
    { pattern: /摇滚|rock/i, value: 'Rock' },
    { pattern: /民谣|folk/i, value: 'Folk' },
    { pattern: /古典|classical/i, value: 'Classical' },
];

const DENSITY_KEYWORDS: readonly Keyword<LocalDensity>[] = [
    {
        pattern: /高密度|密度\s*高|密集|密一点|多音|音符多|high density|dense|busy/i,
        value: '高',
    },
    {
        pattern: /低密度|密度\s*低|稀疏|少音|音符少|长音|low density|sparse/i,
        value: '低',
    },
    {
        pattern: /中密度|密度\s*中|中等|适中|medium density|moderate/i,
        value: '中',
    },
];

const SCALE_KEYWORDS: readonly Keyword<ScaleType>[] = [
    {
        pattern: /自然小调|小调音阶|aeolian|爱奥尼亚/i,
        value: 'Natural Minor (Aeolian)',
    },
    {
        pattern: /和声小调|harmonic minor/i,
        value: 'Harmonic Minor',
    },
    {
        pattern: /大调五声|五声大调|大调五声音阶|major pentatonic/i,
        value: 'Pentatonic Major',
    },
    {
        pattern: /小调五声|五声小调|小调五声音阶|minor pentatonic/i,
        value: 'Pentatonic Minor',
    },
    {
        pattern: /蓝调音阶|布鲁斯音阶|blues scale/i,
        value: 'Blues',
    },
    {
        pattern: /多利亚|dorian/i,
        value: 'Dorian',
    },
    {
        pattern: /混合利底亚|mixolydian/i,
        value: 'Mixolydian',
    },
    {
        pattern: /大调音阶|自然大调|ionian|伊奥尼亚/i,
        value: 'Major (Ionian)',
    },
];

/**
 * 解析描述里的调性。
 *
 * 支持 `D大调` / `a小调` / `C调` / `F# minor` / 独立的 `Am`。
 * 单独的 `D` 不解析——太容易和普通英文单词撞车。
 */
function parseDescriptionKey(
    text: string,
): { key: string; isMinor: boolean } | undefined {
    const withMode = text.match(
        /(?:^|[^A-Za-z])([A-Ga-g])([#b]?)\s*(大调|小调|调|major|minor|maj|min)(?![A-Za-z])/i,
    );
    if (withMode) {
        const isMinor = /小调|minor|min/i.test(withMode[3]);
        const parsed = parseKey(
            `${withMode[1].toUpperCase()}${withMode[2] ?? ''}${isMinor ? 'm' : ''}`,
        );
        if (parsed) return { key: parsed.key, isMinor };
    }

    // 独立的 Am / F#m 这类写法；只认大写字母开头，避免把英文 "am" 当调性。
    const minorChord = text.match(/(?:^|[^A-Za-z])([A-G])([#b]?)m(?![A-Za-z])/);
    if (minorChord) {
        const parsed = parseKey(`${minorChord[1]}${minorChord[2] ?? ''}m`);
        if (parsed) return { key: parsed.key, isMinor: true };
    }

    return undefined;
}

/**
 * 解析描述里的把位范围，如 `7-10品`、`8–13 品`、`把位固定在 8 到 13 品`。
 *
 * 只认带范围连接词的写法；单个品位数字不构成锁定范围。
 */
export function parseDescriptionFretRange(text: string): FretRange | null {
    const patterns: RegExp[] = [
        /(\d{1,2})\s*(?:品)?\s*(?:[-–—~]|到|至)\s*(\d{1,2})\s*品/g,
        /(?:把位|品位)[^0-9]{0,12}(\d{1,2})\s*(?:[-–—~]|到|至)\s*(\d{1,2})/g,
    ];
    const playability = LOCAL_IMPROV_CONFIG.playability;

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            let min = Number(match[1]);
            let max = Number(match[2]);
            if (!Number.isInteger(min) || !Number.isInteger(max)) continue;
            if (min > max) [min, max] = [max, min];
            min = Math.max(playability.fretMin, Math.min(playability.fretMax, min));
            max = Math.max(playability.fretMin, Math.min(playability.fretMax, max));
            return { min, max };
        }
    }
    return null;
}

/**
 * 识别当前本地引擎不支持、但用户明确写出来的需求。
 *
 * 只用于 UI 提示，不参与生成；`La/D 指型` 与自然音限制都属于这一类。
 */
export function detectUnsupportedDescription(text: string): string[] {
    const unsupported: string[] = [];

    if (/指型|CAGED/i.test(text)) {
        unsupported.push('指型图案（La/D 型等）暂未支持，当前按音阶自由度生成');
    }
    if (/自然音(?!阶)|只用白键|不要\s*[A-G][#b]|不要[^。；;\n]{0,6}[升降]|落在\s*[A-G]\s*[-–]\s*[A-G]\s*(?:这些|之间|范围|内|上)/i.test(text)) {
        unsupported.push('自然音/升降音限制暂未支持，生成仍按音阶与和弦音池');
    }

    return unsupported;
}

/** 散文片段：含中文，或全小写英文（如 then / and then）。 */
function isProsePart(part: string): boolean {
    const trimmed = part.trim();
    if (trimmed === '') return true;
    return /[一-鿿]/.test(trimmed) || /^[a-z\s]+$/.test(trimmed);
}

/**
 * 从一段描述里提取小节写法，如 `... 在 | C G | Am F | 内 ...`。
 *
 * 按 `|` 切分：能解析的是和弦组，散文片段跳过；既不是和弦也不是散文
 * （如 `| C | H |` 里的 H）说明写法有误，整行作废，避免静默丢半张表。
 * 单边小节线与跨行续写也按同一规则处理。
 */
export function parseDescriptionChordChart(
    text: string,
): ProgressionStep[][] | null {
    const bars: ProgressionStep[][] = [];

    for (const line of text.split(/\r?\n/)) {
        if (!line.includes('|')) continue;
        const parts = line.split('|');
        const lineBars: ProgressionStep[][] = [];
        let malformed = false;
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed === '') continue;
            const parsed = parseProgressionText(trimmed);
            if (parsed) {
                lineBars.push([...parsed]);
            } else if (!isProsePart(trimmed)) {
                malformed = true;
                break;
            }
        }
        if (!malformed) bars.push(...lineBars);
    }

    return bars.length > 0 ? bars : null;
}

interface LabeledProgression {
    steps: Progression;
    /** 标签结束位置（正文起点） */
    bodyStart: number;
    /** 已消费的正文长度 */
    consumed: number;
}

const PROGRESSION_LABEL = /(?:和弦(?:进行)?|chords?|progression)\s*[:：]?\s*/i;
const LABEL_TOKEN = /[^\s,;，、|–—\-]+/g;
/** 标签正文里一出现就说明和弦列表已结束的短语（调性 / 把位） */
const OPTION_PHRASES: readonly RegExp[] = [
    /\d{1,2}\s*(?:品)?\s*(?:[-–—~]|到|至)\s*\d{1,2}\s*品/,
    /(?:^|[^A-Za-z])[A-Ga-g][#b]?\s*(?:大调|小调|调|major|minor|maj|min)(?![A-Za-z0-9])/i,
];

function optionPhraseStart(text: string): number {
    let best = -1;
    for (const pattern of OPTION_PHRASES) {
        const match = pattern.exec(text);
        if (match?.index !== undefined && (best < 0 || match.index < best)) {
            best = match.index;
        }
    }
    return best;
}

/**
 * 标签进行只吃「连续合法的和弦 token」。
 *
 * 这样 `和弦进行：C G Am F、D 大调` 只取前面的进行，`D 大调` 留给调性
 * 解析；也不会因为行尾还有把位范围而整组作废。第一段若以英文散文结尾，
 * 允许取至少两个合法 token 的前缀。
 */
function parseLabeledProgression(line: string): LabeledProgression | undefined {
    const label = PROGRESSION_LABEL.exec(line);
    if (!label) return undefined;

    const bodyStart = label.index + label[0].length;
    const rawBody = line.slice(bodyStart);
    const stops = [rawBody.search(/[。；;]/), optionPhraseStart(rawBody)]
        .filter(index => index >= 0);
    const body = stops.length > 0
        ? rawBody.slice(0, Math.min(...stops))
        : rawBody;

    const steps: ProgressionStep[] = [];
    let consumed = 0;
    for (const clause of body.matchAll(/[^，,、]+/g)) {
        const clauseText = clause[0];
        const clauseStart = clause.index ?? 0;
        const tokens = Array.from(clauseText.matchAll(LABEL_TOKEN));
        if (tokens.length === 0) continue;

        const parsed: ProgressionStep[] = [];
        let lastValidEnd = clauseStart;
        let allValid = true;
        for (const token of tokens) {
            const step = parseProgressionToken(token[0]);
            if (step === null) {
                allValid = false;
                break;
            }
            parsed.push(step);
            lastValidEnd = clauseStart + (token.index ?? 0) + token[0].length;
        }

        if (allValid) {
            steps.push(...parsed);
            consumed = clauseStart + clauseText.length;
            continue;
        }

        if (steps.length === 0 && parsed.length >= 2) {
            steps.push(...parsed);
            consumed = lastValidEnd;
        }
        break;
    }

    if (steps.length === 0) return undefined;
    return { steps, bodyStart, consumed };
}

/** 描述里的和弦进行：优先显式标签，其次 `| C G | Am F |` 小节写法 */
function parseDescriptionProgression(text: string): Progression | undefined {
    for (const line of text.split(/\r?\n/)) {
        const labeled = parseLabeledProgression(line);
        if (labeled) return labeled.steps;
    }

    const bars = parseDescriptionChordChart(text);
    if (bars) return bars.flat();
    return undefined;
}

/**
 * 去掉描述里已经被进行解析消费的和弦内容，避免把进行中的 `Am` 误当调性。
 *
 * 只用于调性/音阶识别；未消费的尾部（例如 `D 大调`、`7-10品`）保留。
 */
function stripProgressionText(text: string): string {
    return text.split(/\r?\n/).map(line => {
        const label = PROGRESSION_LABEL.exec(line);
        let cleaned = line;
        if (label) {
            const labeled = parseLabeledProgression(line);
            cleaned = labeled
                ? `${line.slice(0, label.index)} ${line.slice(labeled.bodyStart + labeled.consumed)}`
                : `${line.slice(0, label.index)} ${line.slice(label.index + label[0].length)}`;
        }

        const start = cleaned.indexOf('|');
        if (start < 0) return cleaned;
        const end = cleaned.lastIndexOf('|');
        return `${cleaned.slice(0, start)} ${end > start ? cleaned.slice(end + 1) : ''}`;
    }).join('\n');
}

/**
 * 把一段中文/英文描述解析成生成选项。
 *
 * 未识别的文字直接忽略；返回值只包含命中的字段。
 */
export function parseImprovDescription(text: string): Partial<ImprovOptions> {
    const normalized = text.trim();
    if (normalized === '') return {};

    const result: Partial<ImprovOptions> = {};

    const style = findFirst(normalized, STYLE_KEYWORDS);
    if (style !== undefined) result.style = style;

    const density = findFirst(normalized, DENSITY_KEYWORDS);
    if (density !== undefined) result.density = density;

    const measureMatch = normalized.match(/(\d+)\s*(?:小节|measures?|bars?)/i);
    if (measureMatch) {
        const parsed = Number.parseInt(measureMatch[1], 10);
        if (Number.isInteger(parsed) && parsed > 0) {
            const { min, max } = LOCAL_IMPROV_CONFIG.numMeasures;
            result.numMeasures = Math.max(min, Math.min(max, parsed));
        }
    }

    const timeMatch = normalized.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (timeMatch) {
        const signature = `${Number(timeMatch[1])}/${Number(timeMatch[2])}`;
        if (LOCAL_IMPROV_CONFIG.timeSignatures.includes(signature)) {
            result.timeSignature = signature;
        }
    }

    const parsedKey = parseDescriptionKey(stripProgressionText(normalized));
    if (parsedKey) {
        result.key = parsedKey.key;
        // 只写了调性、没写音阶时，按大小调给一个合理默认；显式音阶在下面覆盖。
        result.scaleType = parsedKey.isMinor
            ? 'Natural Minor (Aeolian)'
            : 'Major (Ionian)';
    }

    const scale = findFirst(normalized, SCALE_KEYWORDS);
    if (scale !== undefined) result.scaleType = scale;

    const progression = parseDescriptionProgression(normalized);
    if (progression !== undefined) result.progression = progression;

    const fretRange = parseDescriptionFretRange(normalized);
    if (fretRange !== null) result.fretRange = fretRange;

    return result;
}
