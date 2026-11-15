/**
 * mergeOptions — 合并「面板选项 / AI 需求解析 / 本地关键词解析」。
 *
 * 优先级固定为 base < AI < local：本地明确写出的字段（`7-10品`、
 * `| C G | Am F |`、`La 指型`）不被 AI 覆盖；AI 只补本地没有的字段。
 * 只合并 `ImprovBriefOptions` 白名单里的键，`tuning` / `seed` /
 * `chordChart` 等字段没有入口。
 */

import type {
    ImprovBriefOptions,
    Progression,
} from '../../types/improv/index.ts';

/** 允许合并的键（同时充当运行时白名单，防止解析器漏过滤） */
const MERGE_KEYS = [
    'numMeasures',
    'key',
    'scaleType',
    'style',
    'density',
    'timeSignature',
    'fingering',
    'fretRange',
    'progression',
    'chordsPerMeasure',
] as const;

function cloneProgression(progression: Progression): Progression {
    return progression.map(step => (
        typeof step === 'number' ? step : { ...step }
    ));
}

function assignField(
    target: ImprovBriefOptions,
    field: (typeof MERGE_KEYS)[number],
    source: ImprovBriefOptions,
): void {
    switch (field) {
        case 'fretRange': {
            const range = source.fretRange;
            if (range !== undefined) target.fretRange = { ...range };
            break;
        }
        case 'progression': {
            const progression = source.progression;
            if (progression !== undefined) {
                target.progression = cloneProgression(progression);
            }
            break;
        }
        case 'numMeasures': {
            if (source.numMeasures !== undefined) target.numMeasures = source.numMeasures;
            break;
        }
        case 'key': {
            if (source.key !== undefined) target.key = source.key;
            break;
        }
        case 'scaleType': {
            if (source.scaleType !== undefined) target.scaleType = source.scaleType;
            break;
        }
        case 'style': {
            if (source.style !== undefined) target.style = source.style;
            break;
        }
        case 'density': {
            if (source.density !== undefined) target.density = source.density;
            break;
        }
        case 'timeSignature': {
            if (source.timeSignature !== undefined) target.timeSignature = source.timeSignature;
            break;
        }
        case 'fingering': {
            if (source.fingering !== undefined) target.fingering = source.fingering;
            break;
        }
        case 'chordsPerMeasure': {
            if (source.chordsPerMeasure !== undefined) {
                target.chordsPerMeasure = source.chordsPerMeasure;
            }
            break;
        }
        default:
            break;
    }
}

/**
 * 按 base < AI < local 合并三份选项。
 *
 * @returns 新对象；只含至少有一个来源给出的字段。不修改入参。
 */
export function mergeImprovOptions(
    base: ImprovBriefOptions = {},
    ai: ImprovBriefOptions = {},
    local: ImprovBriefOptions = {},
): ImprovBriefOptions {
    const merged: ImprovBriefOptions = {};
    for (const field of MERGE_KEYS) {
        assignField(merged, field, base);
        assignField(merged, field, ai);
        assignField(merged, field, local);
    }
    return merged;
}
