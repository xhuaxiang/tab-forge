/**
 * improvSummaryState — 记住最近一次生成结果，供语言切换时就地重建摘要。
 *
 * 本地摘要由结构化入参重建，警告按当前语言重新推导；AI 摘要只把
 * 「可翻译部分」存成结构化快照（音符数、扩展统计、摘要入参），切语言后
 * 用当前 `t()` 重建。AI 原文（rationale / unsupported / pipeline 消息）
 * 保留生成时语言，原样回放。
 */

import type { ImprovOptions, LocalImprovResult } from '../../core/types/improv/index.ts';
import type { MessageKey } from '../../core/i18n/index.ts';
import { t } from '../../core/i18n/index.ts';
import { detectUnsupportedDescription } from '../../core/utils/improv/index.ts';
import { buildImprovSummary } from './improvSummary.ts';

interface LocalSummarySnapshot {
    result: LocalImprovResult;
    seed: number;
    description: string;
    described: Partial<ImprovOptions>;
}

interface AiSummarySnapshot {
    sounding: number;
    hasApiKey: boolean;
    applied: number;
    dropped: number;
    /** AI 原文：不翻译 */
    rationale: string;
    result: LocalImprovResult;
    seed: number;
    description: string;
    described: Partial<ImprovOptions>;
    /** 本地不支持项，按当前语言重建 */
    warningKeys: readonly MessageKey[];
    /** AI 原文提示（unsupported / pipeline 消息），生成时语言 */
    aiWarnings: readonly string[];
}

let localSnapshot: LocalSummarySnapshot | null = null;
let aiSnapshot: AiSummarySnapshot | null = null;
/** 失败/异常提示：含动态错误原文，按生成时语言重放 */
let aiText: string | null = null;

/** 记录本地生成的原始入参（摘要文本在需要时按当前语言重建） */
export function setLocalSummarySnapshot(snapshot: LocalSummarySnapshot): void {
    localSnapshot = snapshot;
}

export function clearLocalSummarySnapshot(): void {
    localSnapshot = null;
}

/** 记录成功生成的 AI 摘要入参（可翻译部分在切语言时重建） */
export function setAiSummarySnapshot(snapshot: AiSummarySnapshot): void {
    aiSnapshot = snapshot;
    aiText = null;
}

/** 记录失败/异常提示；传 null 同时清掉旧的成功快照 */
export function setAiSummaryText(text: string | null): void {
    aiText = text;
    aiSnapshot = null;
}

/** 语言切换后重建：本地与 AI 摘要的可翻译部分换语言，AI 原文保留 */
export function renderImprovSummaries(): void {
    if (localSnapshot) {
        const { result, seed, description, described } = localSnapshot;
        const el = document.getElementById('localImprovStatus');
        if (el) {
            el.textContent = buildImprovSummary(
                result,
                seed,
                description,
                described,
                detectUnsupportedDescription(description),
            );
        }
    }

    const el = document.getElementById('aiGenStatus');
    if (!el) return;
    if (aiSnapshot) {
        const s = aiSnapshot;
        const extension = s.hasApiKey
            ? t('ai.extensionApplied', {
                applied: s.applied,
                note: s.dropped > 0 ? t('ai.extensionDropped', { count: s.dropped }) : '',
            })
            : t('ai.extensionSkipped');
        const headline = t('ai.headline', { notes: s.sounding, aiText: extension });
        const summary = buildImprovSummary(
            s.result,
            s.seed,
            s.description,
            s.described,
            [...s.warningKeys.map(key => t(key)), ...s.aiWarnings],
        );
        el.textContent = [
            headline,
            s.rationale ? t('ai.rationale', { rationale: s.rationale }) : '',
            summary,
        ].filter(Boolean).join('\n');
    } else if (aiText !== null) {
        el.textContent = aiText;
    }
}
