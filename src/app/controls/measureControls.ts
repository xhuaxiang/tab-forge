/**
 * measureControls — 小节增删与清空
 */

import { $, setStatusT } from '../dom.ts';
import { scoreStore } from '../../core/stores/scoreStore.ts';
import { t } from '../../core/i18n/index.ts';

export function initMeasureControls(): void {
    // --- 小节操作 ---
    $('addMeasure')?.addEventListener('click', () => {
        const n = scoreStore.addMeasure();
        setStatusT('measure.status.added', { index: n }, 'success');
    });

    $('deleteMeasure')?.addEventListener('click', () => {
        if (!scoreStore.deleteLastMeasure()) {
            setStatusT('measure.status.noneToDelete', undefined, 'error');
            return;
        }
        setStatusT('measure.status.deleted', undefined, 'info');
    });

    $('clearBtn')?.addEventListener('click', () => {
        if (scoreStore.score.measures.length === 0) {
            setStatusT('measure.status.alreadyEmpty', undefined, 'info');
            return;
        }
        if (confirm(t('measure.confirmClear'))) {
            scoreStore.clear();
                setStatusT('measure.status.cleared', undefined, 'info');
        }
    });
}
