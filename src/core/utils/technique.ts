/**
 * technique — 技法分类（纯函数，无 DOM）
 *
 * 「连接类技法」复用前一个同弦音的缓冲区，目标音不再拨弦；
 * 调度层的延音计算与播放层的连接分支必须共用这一份判断。
 */

import type { Note, AppTechnique } from '../types/index.ts';

export const CONNECTING_TECHNIQUES = ['hammerOn', 'pullOff', 'slide'] as const satisfies
    ReadonlyArray<NonNullable<Note['technique']>>;

export type ConnectingTechnique = typeof CONNECTING_TECHNIQUES[number];

/** 接受 AppTechnique（含 'none'），表单状态与音符字段都能直接传入 */
export function isConnectingTechnique(
    technique: AppTechnique | undefined,
): technique is ConnectingTechnique {
    return technique !== undefined
        && (CONNECTING_TECHNIQUES as readonly string[]).includes(technique);
}

/**
 * 连接类技法（H/P/S）的音符实际落在哪个品上。
 *
 * 应用模型里每个 Note 都代表「某一拍真实响的音」：H/P/S 的到达音落在当前拍，
 * 起点音是前一个同弦音。因此谱面/播放只读 `fret`，它必须是**到达品**；
 * 表单里的「品」是起点、「目标品」是到达点，写入时用本函数换算。
 *
 * 非连接类技法时保留原品；连接类技法缺目标品时也回退原品，但表单路径已由
 * `buildNotesFromForm` 的守卫拦下，这里的回退只是通用兜底。
 */
export function resolveSoundingFret(
    fret: number,
    technique: AppTechnique | undefined,
    targetFret: number | undefined,
): number {
    return isConnectingTechnique(technique) && targetFret !== undefined ? targetFret : fret;
}

/**
 * 「品」变化时，连接类技法的「目标品」默认跟随。
 *
 * 表单语义：品是起点、目标品是到达点。切换技法时目标品已同步为当时的品；
 * 之后用户改品，只要目标品**仍是旧品**（即没被显式改过）就跟着走，
 * 否则保留用户输入。非连接类技法不读目标品，原样返回。
 */
export function followTargetFret(
    nextFret: number,
    prevFret: number,
    targetFret: number,
    technique: AppTechnique | undefined,
): number {
    if (!isConnectingTechnique(technique)) return targetFret;
    return targetFret === prevFret ? nextFret : targetFret;
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
