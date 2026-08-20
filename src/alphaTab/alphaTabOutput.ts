/**
 * alphaTabOutput — 自定义 AudioWorklet 输出（消除 ScriptProcessorNode 弃用告警）
 *
 * alphaTab 自带的 AlphaSynthScriptProcessorOutput 使用已废弃的 createScriptProcessor。
 * 这里基于 alphaTab **运行时导出** 的 AlphaSynthWebAudioOutputBase 子类化，
 * 用 AudioWorkletNode 作为播放 sink（audioOutputWorklet.js），
 * 保留基类的 AudioContext / activate / ready / samplesPlayed / sampleRequest 机制。
 *
 * 采样流：alphaTab 合成 → addSamples → 主线程 postMessage 到 worklet →
 *        worklet 在音频线程消费，低水位时回发 request → onSampleRequest。
 */

/** worklet 文件地址：?worker&url 让 Vite 把 audioOutputWorklet.js 独立产出并给 URL */
import workletUrl from './audioOutputWorklet.js?worker&url';

type AlphaTabModule = typeof import('@coderline/alphatab');

/** alphaTab 运行时基类的窄化声明（该基类不在 .d.ts 里导出） */
interface WebAudioOutputBaseInstance {
    context: AudioContext | null;
    source: AudioBufferSourceNode | null;
    buffer: AudioBuffer | null;
    readonly sampleRate: number;
    open(bufferTimeInMilliseconds: number): void;
    play(): void;
    pause(): void;
    destroy(): void;
    activate(resumedCallback?: () => void): void;
    onReady(): void;
    onSamplesPlayed(numberOfSamples: number): void;
    onSampleRequest(): void;
}

type WebAudioOutputBaseCtor = new () => WebAudioOutputBaseInstance;

interface WorkletMessage {
    type: 'request' | 'played' | 'reset' | 'samples';
    count?: number;
    data?: Float32Array;
}

/**
 * 创建 alphaTab 用的 AudioWorklet 输出。
 * @param mod 已加载的 '@coderline/alphatab' 模块（由 alphaTabPlayer 传入）
 */
export function createAlphaTabWorkletOutput(
    mod: AlphaTabModule,
): import('@coderline/alphatab').synth.ISynthOutput {
    const Base = (mod.synth as unknown as {
        AlphaSynthWebAudioOutputBase: WebAudioOutputBaseCtor;
    }).AlphaSynthWebAudioOutputBase;

    class AlphaSynthWorkletOutput extends Base {
        private _workletNode: AudioWorkletNode | null = null;
        private _connected = false;
        private _pendingSamples: Float32Array[] = [];

        open(bufferTimeInMilliseconds: number): void {
            super.open(bufferTimeInMilliseconds);
            this.onReady();
        }

        play(): void {
            super.play();
            // 先请求一轮合成，addModule 期间采样进入 _pendingSamples
            this.onSampleRequest();
            void this._ensureWorklet().then(() => {
                const node = this._workletNode;
                const ctx = this.context;
                if (!node || !ctx || this._connected) return;
                node.connect(ctx.destination, 0, 0);
                this._connected = true;
                this._flushPending();
            });
        }

        pause(): void {
            super.pause();
            if (this._workletNode) this._workletNode.disconnect(0);
            this._connected = false;
        }

        destroy(): void {
            this.pause();
            this._workletNode?.port.close();
            this._workletNode = null;
            this._pendingSamples = [];
            super.destroy();
        }

        addSamples(samples: Float32Array): void {
            // 拷贝而非 transfer：避免 alphaTab 复用 buffer 造成 detach 问题
            const chunk = samples.slice();
            const node = this._workletNode;
            if (node) {
                node.port.postMessage({ type: 'samples', data: chunk });
            } else {
                this._pendingSamples.push(chunk);
            }
        }

        resetSamples(): void {
            this._pendingSamples = [];
            this._workletNode?.port.postMessage({ type: 'reset' });
        }

        private async _ensureWorklet(): Promise<void> {
            const ctx = this.context;
            if (!ctx || this._workletNode) return;
            await ctx.audioWorklet.addModule(workletUrl);
            const node = new AudioWorkletNode(ctx, 'tabforge-synth-output', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });
            node.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
                this._onWorkletMessage(e.data);
            };
            this._workletNode = node;
        }

        private _onWorkletMessage(msg: WorkletMessage): void {
            if (msg.type === 'request') {
                if (this._connected) this.onSampleRequest();
            } else if (msg.type === 'played' && typeof msg.count === 'number') {
                this.onSamplesPlayed(msg.count);
            }
        }

        private _flushPending(): void {
            const node = this._workletNode;
            if (!node) return;
            for (const chunk of this._pendingSamples) {
                node.port.postMessage({ type: 'samples', data: chunk });
            }
            this._pendingSamples = [];
        }
    }

    return new AlphaSynthWorkletOutput() as unknown as import('@coderline/alphatab').synth.ISynthOutput;
}
