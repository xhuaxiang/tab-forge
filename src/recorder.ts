/**
 * recorder — 音频录音管理（麦克风 → MediaRecorder）
 *
 * 与播放引擎无关，独立成模块，供"未来 AI 扒谱分析"采集音频用。
 */

/**
 * 录音管理器
 */
export class AudioRecorder {
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private stream: MediaStream | null = null;
    private isRecording: boolean = false;

    /** 开始录音 */
    async startRecording(): Promise<boolean> {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : 'audio/mp4',
            });

            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            return true;
        } catch (error) {
            console.error('录音启动失败:', error);
            return false;
        }
    }

    /** 停止录音 */
    stopRecording(): Blob | null {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;

            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }

            if (this.audioChunks.length > 0) {
                return new Blob(this.audioChunks, { type: 'audio/webm' });
            }
        }
        return null;
    }

    /** 获取录音状态 */
    getIsRecording(): boolean {
        return this.isRecording;
    }
}

/** 全局单例 */
export const currentAudioRecorder = new AudioRecorder();
