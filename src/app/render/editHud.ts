/**
 * editHud — 谱面只读光标的读数条
 *
 * 只做文案渲染；光标数据与拍位标签分别来自 scoreStore 与 core/utils。
 */

import { scoreStore } from '../../core/stores/scoreStore.ts';
import { cursorBeatLabel } from '../../core/utils/measureUtils.ts';
import type { EditCursor } from '../../core/types/index.ts';

const HINT = '点击谱面定位光标';

/** 更新 #scoreEditHud 文案；无光标时显示操作提示 */
export function renderEditHud(cursor: EditCursor | null): void {
    const el = document.getElementById('scoreEditHud');
    if (!el) return;

    if (!cursor) {
        el.textContent = HINT;
        el.classList.remove('active');
        return;
    }

    const measure = scoreStore.score.measures[cursor.measureIndex];
    if (!measure) {
        el.textContent = HINT;
        el.classList.remove('active');
        return;
    }

    el.textContent = `小节 ${cursor.measureIndex + 1} · ${cursorBeatLabel(measure, cursor.beatOffset)} · ${cursor.string} 弦`;
    el.classList.add('active');
}
