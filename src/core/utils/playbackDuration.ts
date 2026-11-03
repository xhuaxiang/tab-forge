/**
 * playbackDuration — 播放时值换算（纯函数，无 DOM）
 *
 * 把记谱时值与奏法开关换算成实际发声时长。
 * 只处理会影响源缓冲长度的奏法；音量系数与技法连接由播放层负责。
 */

import type { Note } from '../types/index.ts';
import { KARPLUS_ARTICULATION } from '../config.ts';

/**
 * 解析音符的实际发声时长（秒）。
 *
 * 断音优先于自由延音：两者同时开时，断音不应被 letRing 的额外延长抵消。
 * 手掌闷音/制音再取各自的上限。
 */
export function resolvePlayDuration(note: Note, notatedDurationSec: number): number {
    let duration = notatedDurationSec;
    if (note.staccato) {
        duration *= KARPLUS_ARTICULATION.staccatoDurationFactor;
    } else if (note.letRing) {
        duration += KARPLUS_ARTICULATION.letRingExtraSec;
    }
    if (note.palmMute) {
        duration = Math.min(duration, KARPLUS_ARTICULATION.palmMuteMaxSec);
    }
    if (note.deadNote) {
        duration = Math.min(duration, KARPLUS_ARTICULATION.deadNoteMaxSec);
    }
    return duration;
}
