/**
 * editHud — 谱面只读光标的读数条
 *
 * 只做文案渲染；光标数据与拍位标签分别来自 scoreStore 与 core/utils。
 */

import { scoreStore } from '../../core/stores/scoreStore.ts';
import { cursorBeatLabel } from '../../core/utils/measureUtils.ts';
import { t } from '../../core/i18n/index.ts';
import type { EditCursor } from '../../core/types/index.ts';

/** 更新 #scoreEditHud 文案；无光标时显示操作提示 */
export function renderEditHud(cursor: EditCursor | null): void {
    const el = document.getElementById('scoreEditHud');
    if (!el) return;

    if (!cursor) {
        el.textContent = t('hud.hint');
        el.classList.remove('active');
        return;
    }

    const measure = scoreStore.score.measures[cursor.measureIndex];
    if (!measure) {
        el.textContent = t('hud.hint');
        el.classList.remove('active');
        return;
    }

    el.textContent = t('hud.cursor', {
        measure: cursor.measureIndex + 1,
        beat: cursorBeatLabel(measure, cursor.beatOffset),
        string: cursor.string,
    });
    el.classList.add('active');
}
