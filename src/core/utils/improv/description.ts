/**
 * description — 本地即兴的自由描述 → 生成选项。
 *
 * 只做关键词匹配，不做语义理解：命中的字段覆盖下拉框，没命中的保持原值。
 * 同一段文字里出现多个同类词时，取文本中最先出现的那个；纯函数，无 DOM。
 */

import type {
    ImprovOptions,
    LocalDensity,
    LocalStyle,
    ScaleType,
} from '../../types/improv.ts';
import { LOCAL_IMPROV_CONFIG } from '../../config.ts';
import { parseKey } from './pitch.ts';

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

    const parsedKey = parseDescriptionKey(normalized);
    if (parsedKey) {
        result.key = parsedKey.key;
        // 只写了调性、没写音阶时，按大小调给一个合理默认；显式音阶在下面覆盖。
        result.scaleType = parsedKey.isMinor
            ? 'Natural Minor (Aeolian)'
            : 'Major (Ionian)';
    }

    const scale = findFirst(normalized, SCALE_KEYWORDS);
    if (scale !== undefined) result.scaleType = scale;

    return result;
}
