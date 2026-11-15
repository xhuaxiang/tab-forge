/**
 * contractConstants — AI 响应的白名单常量（唯一来源）。
 *
 * 旧「从零生成」解析器与新的 brief / patch 解析器共用，避免各写一份后漂移。
 * 取值本身仍来自 `core/types`；这里只做 AI 输入侧的收口与类型守卫。
 */

import type { AppHarmonic, Note } from '../../core/types/index.ts';
import { APP_HARMONICS } from '../../core/types/index.ts';
import { PERFORMANCE_TECHNIQUES } from '../../core/types/improv/index.ts';

/**
 * AI 允许输出的技法 —— 与表现层补丁共用同一份 `PERFORMANCE_TECHNIQUES`。
 *
 * 这是 `Note.technique` 的全集（core/types/note/index.ts），五种都给 AI；
 * 增删技法只改 core 那一处，AI 契约与本地校验器自动同步。
 */
export const AI_TECHNIQUES = PERFORMANCE_TECHNIQUES;
export type AITechnique = (typeof AI_TECHNIQUES)[number];

/** AI 允许输出的力度取值（`Note.dynamics` 的全集） */
export const AI_DYNAMICS = ['soft', 'accent'] as const;
export type AIDynamics = (typeof AI_DYNAMICS)[number];

/** 合法的推弦幅度（以全音为单位）：1/4 音、1/2 音、全音 */
export const AI_BEND_AMOUNTS = [0.25, 0.5, 1] as const;
export type AIBendAmount = (typeof AI_BEND_AMOUNTS)[number];

/** 泛音白名单直接取 core/types 的 APP_HARMONICS，避免与契约各写一份 */
export const AI_HARMONICS = APP_HARMONICS;

type _AssertTrue<T extends true> = T;

/** 编译期护栏：技法白名单必须是 `Note.technique` 的子集 */
export type _AITechniquesAreNoteTechniques = _AssertTrue<
    AITechnique extends NonNullable<Note['technique']> ? true : false
>;

/** 编译期护栏：力度白名单必须是 `Note.dynamics` 的子集 */
export type _AIDynamicsAreNoteDynamics = _AssertTrue<
    AIDynamics extends NonNullable<Note['dynamics']> ? true : false
>;

export function isAITechnique(value: unknown): value is AITechnique {
    return typeof value === 'string'
        && (AI_TECHNIQUES as readonly string[]).includes(value);
}

export function isAIDynamics(value: unknown): value is AIDynamics {
    return typeof value === 'string'
        && (AI_DYNAMICS as readonly string[]).includes(value);
}

export function isAIHarmonic(value: unknown): value is AppHarmonic {
    return typeof value === 'string'
        && (AI_HARMONICS as readonly string[]).includes(value);
}

export function isAIBendAmount(value: unknown): value is AIBendAmount {
    return typeof value === 'number'
        && (AI_BEND_AMOUNTS as readonly number[]).includes(value);
}
