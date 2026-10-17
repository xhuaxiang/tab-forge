/**
 * renderControls — 渲染方式切换（画布 / alphaTab）
 */

import { setStatus } from './dom.ts';
import { setRenderMode, isRenderMode } from './render.ts';

export function initRenderControls(): void {
    document.querySelectorAll('#rendererSwitch button').forEach(btn => {
        btn.addEventListener('click', async () => {
            const mode = btn.getAttribute('data-render');
            if (!isRenderMode(mode)) return;
            document.querySelectorAll('#rendererSwitch button').forEach(b => {
                b.classList.toggle('active', b === btn);
            });
            try {
                await setRenderMode(mode);
                setStatus(mode === 'alphaTab' ? '已切换到 alphaTab 渲染' : '已切换到画布渲染', 'info');
            } catch (e) {
                console.error('切换渲染器失败，回退画布', e);
                setStatus('alphaTab 渲染初始化失败，已回退画布', 'error');
                document.querySelectorAll('#rendererSwitch button').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-render') === 'canvas');
                });
                await setRenderMode('canvas');
            }
        });
    });
}
