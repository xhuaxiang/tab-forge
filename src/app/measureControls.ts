/**
 * measureControls — 小节增删与清空
 */

import { $, setStatus } from './dom.ts';
import { scoreStore } from '../core/stores/scoreStore.ts';

export function initMeasureControls(): void {
    // --- 小节操作 ---
    $('addMeasure')?.addEventListener('click', () => {
        const n = scoreStore.addMeasure();
        setStatus(`已添加小节 ${n}`, 'success');
    });

    $('deleteMeasure')?.addEventListener('click', () => {
        if (!scoreStore.deleteLastMeasure()) {
            setStatus('无小节可删', 'error');
            return;
        }
        setStatus('已删除最后一个小节', 'info');
    });

    $('clearBtn')?.addEventListener('click', () => {
        if (scoreStore.score.measures.length === 0) {
            setStatus('已是空状态', 'info');
            return;
        }
        if (confirm('确定清空所有小节？')) {
            scoreStore.clear();
                setStatus('已清空', 'info');
        }
    });
}
