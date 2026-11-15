/**
 * playbackControls — 播放 / 停止 / 录音
 */

import { $, setStatus } from '../dom.ts';
import { scoreStore } from '../../core/stores/scoreStore.ts';
import { DEFAULT_PLAYBACK_ENGINE, isPlaybackEngine } from '../../core/config.ts';

export function initPlaybackControls(): void {
    // --- 播放 ---
    $('playBtn')?.addEventListener('click', async () => {
        if (scoreStore.score.measures.length === 0) { setStatus('无内容', 'error'); return; }
        const playBtn = $('playBtn')!;
        const stopBtn = $('stopBtn')!;
        const callbacks: import('../../features/playback/index.ts').PlaybackCallbacks = {
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
        const engineSelect = $('engineSelect') as HTMLSelectElement | null;
        const engineValue = engineSelect?.value;
        const engine = isPlaybackEngine(engineValue) ? engineValue : DEFAULT_PLAYBACK_ENGINE;

        const { alphaTabPlayer } = await import('../../features/playback/soundfont/index.ts');
        const { currentAudioEngine } = await import('../../features/playback/karplus/index.ts');

        // 正在响的引擎与下拉框一致时，按钮才是「暂停」；不一致说明用户刚切换了
        // 引擎，继续走下面的播放路径（先停旧引擎，再从新引擎起播）。
        const playingEngine = alphaTabPlayer.getState() === 'playing'
            ? 'alphatab'
            : currentAudioEngine.getState() === 'playing'
                ? 'ks'
                : null;
        if (playingEngine === engine) {
            if (engine === 'alphatab') {
                alphaTabPlayer.setCallbacks(callbacks);
                alphaTabPlayer.pause();
            } else {
                currentAudioEngine.setCallbacks(callbacks);
                currentAudioEngine.pause();
            }
            return;
        }

        // 两个引擎各自独立出声，若另一个还在播，换引擎播放会叠成两轨（听感：节奏错乱）
        const stopOtherEngine = async (target: 'alphatab' | 'karplus') => {
            if (target === 'alphatab') {
                if (currentAudioEngine.getState() === 'playing' || currentAudioEngine.getState() === 'paused') {
                    currentAudioEngine.stop();
                }
            } else if (alphaTabPlayer.getState() === 'playing' || alphaTabPlayer.getState() === 'paused') {
                alphaTabPlayer.stop();
            }
        };

        if (engine === 'alphatab') {
            try {
                await stopOtherEngine('alphatab');
                alphaTabPlayer.setCallbacks(callbacks);
                await alphaTabPlayer.play(scoreStore.score);
                return;
            } catch (e) {
                console.error('alphaTab 播放失败，回退 Karplus-Strong', e);
                setStatus('SoundFont 播放失败，已回退合成器', 'error');
                // 下拉框同步到实际发声的引擎，否则下次点击仍会先尝试已失败的 SoundFont
                if (engineSelect) engineSelect.value = 'ks';
            }
        }
        await stopOtherEngine('karplus');
        currentAudioEngine.setCallbacks(callbacks);
        await currentAudioEngine.play(scoreStore.score);
    });

    $('stopBtn')?.addEventListener('click', async () => {
        const { currentAudioEngine } = await import('../../features/playback/karplus/index.ts');
        currentAudioEngine.stop();
        const { alphaTabPlayer } = await import('../../features/playback/soundfont/index.ts');
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
