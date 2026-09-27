/**
 * techniqueAdapter — 技法 / 延音的后处理（纯函数，无 DOM / audio）
 *
 * 与 scoreAdapter.ts 的分工：
 * - scoreAdapter 负责「按结构 1:1 映射」：TabScore → alphaTab Score 的整棵树。
 * - 本文件负责「在已建好的 alphaTab 树上做二次修改」：一个技法往往要落到
 *   **前一个**音符上（击弦/勾弦/滑弦的弧线起点在上游），所以要拿到播放顺序里
 *   跨槽的历史，scoreAdapter 在建树时顺手把 flatten 列表交给这里。
 *
 * 之所以独立成文件：这部分是带 switch 的分支逻辑 + 跨槽回看，与结构映射的
 * 输入/可测性/扩展面都不同（加一种技法只动本文件）。
 */

import * as alphaTab from '@coderline/alphatab';
import type { Note } from '../../core/types/index.ts';

/**
 * 扁平化后的音符条目，供技法/延音的跨槽 lookbehind 使用。
 *
 * 由 scoreAdapter 在构造 Beat/Note 时按**播放顺序**逐个 push，
 * 因此数组下标顺序 == 播放顺序，`prevSameString` 才能向左回看。
 */
export interface FlatEntry {
    /** 应用侧音符（技法、延音、推弦幅度都从这里读） */
    appNote: Note;
    /** 已建好的 alphaTab 音符（技法要写回它） */
    alphaNote: alphaTab.model.Note;
    /** alphaTab 弦号（1=最底弦），回看时用于匹配「同一根弦」 */
    alphaString: number;
}

/**
 * 遍历 flat 列表，把应用侧技法/延音翻译成 alphaTab 的标记。
 *
 * 注意「谁挂标记」的不对称：应用侧的 `technique` 挂在**技法音符自己**身上
 * （如 hammerOn 记在目标音上），而 alphaTab 要求 `isHammerPullOrigin` /
 * `slideOutType` 挂在**前一个**音符上，故这里要回看。
 */
export function applyTechniques(flat: FlatEntry[]): void {
    for (let i = 0; i < flat.length; i++) {
        const { appNote, alphaNote, alphaString } = flat[i];
        if (appNote.isRest) continue;

        // 延音目标：tieToNext 且非技法（技法音符的 tie 只表示弧线，不合并播放）
        if (appNote.tieToNext && !appNote.technique) {
            alphaNote.isTieDestination = true;
        }

        switch (appNote.technique) {
            case 'hammerOn':
            case 'pullOff': {
                // 击/勾弦：标记前一个音为 origin，方向由 alphaTab 依两者品位自行判断
                const prev = prevSameString(flat, i, alphaString);
                if (prev) prev.alphaNote.isHammerPullOrigin = true;
                break;
            }
            case 'slide': {
                // 滑弦：前一个音标记为滑出（Shift = 同弦平移），目标品由本音自带
                const prev = prevSameString(flat, i, alphaString);
                if (prev) prev.alphaNote.slideOutType = alphaTab.model.SlideOutType.Shift;
                break;
            }
            case 'bend': {
                // app bendAmount 以**全音**为单位；alphaTab BendPoint.value 以四分之一音为单位
                // （1 全音 = 4 个四分之一音，故 ×4；Karplus 侧转半音是 ×2，两边同源）
                const semitones = appNote.bendAmount ?? 1;
                const value = Math.round(semitones * 4);
                // ⚠️ 必须走 addBendPoint()，不能直接赋值 bendPoints 数组：
                // alphaTab 的 `maxBendPoint` 只在 addBendPoint 里维护，渲染器会读
                // `note.maxBendPoint.value`（alphaTab.js 的 _maxBendValue 计算），
                // 绕过 API 会让它保持 null 并抛
                // 「Cannot read properties of null (reading 'value')」——整个谱面渲染失败。
                // 顺序：先定 bendType（addBendPoint 只在 None 时才改成 Custom，不会覆盖它）。
                const addPoints = (points: Array<[number, number]>): void => {
                    for (const [offset, v] of points) {
                        alphaNote.addBendPoint(new alphaTab.model.BendPoint(offset, v));
                    }
                };
                if (appNote.bendRelease) {
                    // 推上去再放回来：0 → 峰 → 峰 → 0（时间轴单位为百分比）
                    // ⚠️ 必须是**四个**点：alphaTab 的 BendRelease 规范形态就是 4 点
                    // （它的 finish() 遇到 3 点输入会把中间点复制一份补成 4 点），
                    // 而推弦绘制 TabBendGlyph 会无条件读 bendPoints[3]，给 3 点会抛
                    // 「Cannot read properties of undefined (reading 'value')」。
                    // 偏移取 0 / MaxPosition/2 / MaxPosition = 0 / 30 / 60。
                    alphaNote.bendType = alphaTab.model.BendType.BendRelease;
                    addPoints([[0, 0], [30, value], [30, value], [60, 0]]);
                } else {
                    // 只推不释：0 → 峰
                    alphaNote.bendType = alphaTab.model.BendType.Bend;
                    addPoints([[0, 0], [60, value]]);
                }
                break;
            }
            case 'vibrato': {
                // 应用侧只有「有没有揉弦」，衰减程度固定取弱揉
                alphaNote.vibrato = alphaTab.model.VibratoType.Slight;
                break;
            }
            default:
                // 'none' 与未知值：不挂任何标记
                break;
        }
    }
}

/** 在 flat 列表里向前找同弦的最近一个非休止音符 */
function prevSameString(
    flat: FlatEntry[],
    upTo: number,
    alphaString: number,
): FlatEntry | null {
    for (let j = upTo - 1; j >= 0; j--) {
        const e = flat[j];
        if (!e.appNote.isRest && e.alphaString === alphaString) return e;
    }
    return null;
}
