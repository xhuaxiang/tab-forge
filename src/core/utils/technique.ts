/**
 * technique — 技法分类（纯函数，无 DOM）
 *
 * 「连接类技法」复用前一个同弦音的缓冲区，目标音不再拨弦；
 * 调度层的延音计算与播放层的连接分支必须共用这一份判断。
 */

import type { Note } from '../types/index.ts';

export const CONNECTING_TECHNIQUES = ['hammerOn', 'pullOff', 'slide'] as const satisfies
    ReadonlyArray<NonNullable<Note['technique']>>;

export type ConnectingTechnique = typeof CONNECTING_TECHNIQUES[number];

export function isConnectingTechnique(
    technique: Note['technique'] | undefined,
): technique is ConnectingTechnique {
    return technique !== undefined
        && (CONNECTING_TECHNIQUES as readonly string[]).includes(technique);
}

/**
 * 目标音是否能通过复用源音缓冲区发声。
 *
 * 制音/泛音必须重新拨弦：前者只剩打击感，后者是另一套泛音音色。
 * 调度层与播放层都走这一份判断，避免一边延长、另一边却重拨。
 */
export function isConnectingTarget(note: Note): boolean {
    return isConnectingTechnique(note.technique) && !note.deadNote && !note.harmonic;
}

/**
 * 源音能否作为连接技法的发声基础。
 *
 * 手掌闷音/制音的衰减按固定短包络走，不随传入的 sustain 延长；
 * 断音则被有意缩短时值。这三类源音若被 ring 拉长，就违背了记谱奏法，
 * 因此让目标重新拨弦，而不是复用它们的缓冲区。
 */
export function canSourceTechnique(note: Note): boolean {
    return !note.palmMute && !note.deadNote && !note.staccato;
}
