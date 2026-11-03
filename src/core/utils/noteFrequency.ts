/**
 * 音符频率解析（纯函数）。
 *
 * 播放层（audioEngine）与调度层的技法链速率推导必须用同一份音高换算，
 * 尤其是泛音：natural 以空弦为基频、artificial/pinch 以按弦音为基频，
 * 再按触弦节点的泛音表叠加。此处复刻原 audioEngine 的内联逻辑。
 */

import type { Note, Tuning } from '../types/index.ts';
import { getNoteFromFret, getNoteFrequency } from '../types/index.ts';
import { DEFAULT_HARMONIC_FRET } from '../config.ts';
import { deltaFretToHarmonicValue, harmonicValueToSemitones } from './scoreMapping.ts';
import { semitonesToRate } from './frequency.ts';

/**
 * 解析音符的（未推弦）基频，单位 Hz；无法解析返回 0。
 *
 * @param tuning 当前调弦
 * @param note   目标音符（读 string / fret / harmonic / harmonicFret）
 */
export function resolveNoteFrequency(tuning: Tuning, note: Note): number {
    if (note.string == null) return 0;

    const noteName = getNoteFromFret(tuning, note.string, note.fret ?? 0);
    let frequency = getNoteFrequency(noteName);
    if (!note.harmonic || frequency <= 0) return frequency;

    // 泛音：natural 从空弦叠加，人工/捏弦从按弦音叠加（半音数由节点品位查表）
    const baseName = note.harmonic === 'natural'
        ? getNoteFromFret(tuning, note.string, 0)
        : noteName;
    const baseFrequency = getNoteFrequency(baseName);
    if (baseFrequency <= 0) return frequency;

    const deltaFret = note.harmonic === 'natural'
        ? (note.fret ?? 0)
        : (note.harmonicFret ?? DEFAULT_HARMONIC_FRET);
    const semitones = harmonicValueToSemitones(deltaFretToHarmonicValue(deltaFret));
    frequency = baseFrequency * semitonesToRate(semitones);
    return frequency;
}
