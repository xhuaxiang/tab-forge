/**
 * playbackControls — 播放 / 停止 / 录音
 */

import { $, setStatus } from './dom.ts';
import { scoreStore } from '../core/stores/scoreStore.ts';
import { DEFAULT_PLAYBACK_ENGINE, isPlaybackEngine } from '../core/config.ts';

export function initPlaybackControls(): void {
    // --- 播放 ---
    $('playBtn')?.addEventListener('click', async () => {
        if (scoreStore.score.measures.length === 0) { setStatus('无内容', 'error'); return; }
        const playBtn = $('playBtn')!;
        const stopBtn = $('stopBtn')!;
        const callbacks: import('../features/playback/index.ts').PlaybackCallbacks = {
            onStateChange: (s) => {
                playBtn.textContent = s === 'playing' ? '⏸ 暂停' : (s === 'paused' ? '▶ 继续' : '▶ 播放');
                stopBtn.toggleAttribute('disabled', s === 'stopped');
            },
            onPositionChange: (mi) => setStatus(`播放: 小节 ${mi + 1}/${scoreStore.score.measures.length}`, 'info'),
            onComplete: () => {
                setStatus('播放完成', 'success');
                playBtn.textContent = '▶ 播放';
                stopBtn.setAttribute('disabled', '');
            },
        };
        // 取值不合法（HTML 与 PLAYBACK_ENGINES 漂了）就回落到默认引擎，而不是静默变成别的
        const engineValue = ($('engineSelect') as HTMLSelectElement | null)?.value;
        const engine = isPlaybackEngine(engineValue) ? engineValue : DEFAULT_PLAYBACK_ENGINE;
        if (engine === 'alphatab') {
            try {
                const { alphaTabPlayer } = await import('../features/playback/soundfont/index.ts');
                alphaTabPlayer.setCallbacks(callbacks);
                await alphaTabPlayer.play(scoreStore.score);
                return;
            } catch (e) {
                console.error('alphaTab 播放失败，回退 Karplus-Strong', e);
                setStatus('SoundFont 播放失败，已回退合成器', 'error');
            }
        }
        const audioEngine = (await import('../features/playback/karplus/index.ts')).currentAudioEngine;
        audioEngine.setCallbacks(callbacks);
        await audioEngine.play(scoreStore.score);
    });

    $('stopBtn')?.addEventListener('click', async () => {
        const { currentAudioEngine } = await import('../features/playback/karplus/index.ts');
        currentAudioEngine.stop();
        const { alphaTabPlayer } = await import('../features/playback/soundfont/index.ts');
        alphaTabPlayer.stop();
        setStatus('已停止', 'info');
    });

    // --- 录音 ---
    $('recordBtn')?.addEventListener('click', async () => {
        const btn = $('recordBtn')!;
        const st = $('audioStatus')!;
        const { currentAudioRecorder } = await import('./recorder.ts');
        if (currentAudioRecorder.getIsRecording()) {
            const blob = currentAudioRecorder.stopRecording();
            btn.textContent = '⏺ 录音';
            btn.classList.remove('recording');
            st.textContent = blob ? `完成: ${(blob.size / 1024).toFixed(1)} KB` : '已停止';
            setStatus(blob ? '录音完成' : '已停止', blob ? 'success' : 'info');
        } else {
            const ok = await currentAudioRecorder.startRecording();
            if (ok) {
                btn.textContent = '⏹ 停止';
                btn.classList.add('recording');
                st.textContent = '🔴 录音中...';
                setStatus('录音中', 'info');
            } else {
                st.textContent = '启动失败';
                setStatus('麦克风权限被拒', 'error');
            }
        }
    });
}
