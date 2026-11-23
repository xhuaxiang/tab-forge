/**
 * playbackControls — 播放 / 停止 / 录音
 */

import { $, setStatusT } from '../dom.ts';
import { scoreStore } from '../../core/stores/scoreStore.ts';
import { DEFAULT_PLAYBACK_ENGINE, isPlaybackEngine } from '../../core/config.ts';
import { t } from '../../core/i18n/index.ts';
import { markPlaybackStarted, markPlaybackStopped } from '../analytics.ts';
import type { PlaybackState } from '../../core/types/index.ts';

type AudioStatus =
    | { kind: 'ready' }
    | { kind: 'recording' }
    | { kind: 'complete'; kb: string }
    | { kind: 'stopped' }
    | { kind: 'failed' };

/** 播放/录音的最近状态：语言切换时按它重建按钮文案（不打断播放与录音） */
let lastPlaybackState: PlaybackState = 'stopped';
let lastRecording = false;
let audioStatus: AudioStatus = { kind: 'ready' };

function renderPlayButton(): void {
    const btn = $('playBtn');
    if (!btn) return;
    btn.textContent = lastPlaybackState === 'playing'
        ? t('playback.pause')
        : lastPlaybackState === 'paused' ? t('playback.resume') : t('toolbar.play');
}

function renderStopButton(): void {
    $('stopBtn')?.toggleAttribute('disabled', lastPlaybackState === 'stopped');
}

function renderRecordButton(): void {
    const btn = $('recordBtn');
    if (!btn) return;
    btn.textContent = lastRecording ? t('toolbar.stop') : t('record.start');
    btn.classList.toggle('recording', lastRecording);
}

function renderAudioStatus(): void {
    const el = $('audioStatus');
    if (!el) return;
    switch (audioStatus.kind) {
        case 'recording':
            el.textContent = t('record.status.recording');
            break;
        case 'complete':
            el.textContent = t('record.status.complete', { kb: audioStatus.kb });
            break;
        case 'stopped':
            el.textContent = t('common.stopped');
            break;
        case 'failed':
            el.textContent = t('record.status.startFailed');
            break;
        default:
            el.textContent = t('audio.ready');
    }
}

/** 语言切换后就地更新播放/录音文案（保留播放与录音本身） */
export function refreshPlaybackLabels(): void {
    renderPlayButton();
    renderStopButton();
    renderRecordButton();
    renderAudioStatus();
}

export function initPlaybackControls(): void {
    // --- 播放 ---
    $('playBtn')?.addEventListener('click', async () => {
        if (scoreStore.score.measures.length === 0) { setStatusT('playback.status.empty', undefined, 'error'); return; }
        const callbacks: import('../../features/playback/index.ts').PlaybackCallbacks = {
            onStateChange: (s) => {
                lastPlaybackState = s;
                renderPlayButton();
                renderStopButton();
            },
            onPositionChange: (mi) => setStatusT('playback.status.position', {
                measure: mi + 1,
                total: scoreStore.score.measures.length,
            }, 'info'),
            onComplete: () => {
                setStatusT('playback.status.complete', undefined, 'success');
                markPlaybackStopped();
                lastPlaybackState = 'stopped';
                renderPlayButton();
                renderStopButton();
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
                markPlaybackStarted();
                await alphaTabPlayer.play(scoreStore.score);
                return;
            } catch (e) {
                console.error('alphaTab 播放失败，回退 Karplus-Strong', e);
                setStatusT('playback.status.fallback', undefined, 'error');
                // 下拉框同步到实际发声的引擎，否则下次点击仍会先尝试已失败的 SoundFont
                if (engineSelect) engineSelect.value = 'ks';
            }
        }
        await stopOtherEngine('karplus');
        currentAudioEngine.setCallbacks(callbacks);
        markPlaybackStarted();
        await currentAudioEngine.play(scoreStore.score);
    });

    $('stopBtn')?.addEventListener('click', async () => {
        const { currentAudioEngine } = await import('../../features/playback/karplus/index.ts');
        currentAudioEngine.stop();
        const { alphaTabPlayer } = await import('../../features/playback/soundfont/index.ts');
        alphaTabPlayer.stop();
        markPlaybackStopped();
        lastPlaybackState = 'stopped';
        renderPlayButton();
        renderStopButton();
        setStatusT('common.stopped', undefined, 'info');
    });

    // --- 录音 ---
    $('recordBtn')?.addEventListener('click', async () => {
        const { currentAudioRecorder } = await import('./recorder.ts');
        if (currentAudioRecorder.getIsRecording()) {
            const blob = currentAudioRecorder.stopRecording();
            lastRecording = false;
            audioStatus = blob ? { kind: 'complete', kb: (blob.size / 1024).toFixed(1) } : { kind: 'stopped' };
            renderRecordButton();
            renderAudioStatus();
            setStatusT(blob ? 'record.status.completeStatus' : 'common.stopped', undefined, blob ? 'success' : 'info');
        } else {
            const ok = await currentAudioRecorder.startRecording();
            if (ok) {
                lastRecording = true;
                audioStatus = { kind: 'recording' };
                renderRecordButton();
                renderAudioStatus();
                setStatusT('record.status.active', undefined, 'info');
            } else {
                audioStatus = { kind: 'failed' };
                renderAudioStatus();
                setStatusT('record.status.micDenied', undefined, 'error');
            }
        }
    });
}
