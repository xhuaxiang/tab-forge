/**
 * TabForge SoundFont 播放的 AudioWorkletProcessor
 *
 * 由 alphaTabOutput.ts 通过 audioWorklet.addModule() 加载。
 * 自包含（无 import），在主线程消息驱动下消费交错立体声采样：
 * - 主线程 postMessage({ type:'samples', data: Float32Array }) 追加采样
 * - 采样不足时 postMessage({ type:'request' }) 请求主线程合成更多
 * - 每个渲染量子结束后 postMessage({ type:'played', count }) 回报已播帧数
 */

class TabForgeSynthProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = new Float32Array(0);
        this._readIndex = 0;
        this._writeIndex = 0;
        this._requestPending = false;
        /** 低水位（帧）。低于此值向主线程请求更多采样 */
        this._lowWatermark = 4096;
        this.port.onmessage = (e) => this._onMessage(e.data);
    }

    _pending() {
        return this._writeIndex - this._readIndex;
    }

    _onMessage(msg) {
        if (!msg) return;
        if (msg.type === 'samples') {
            this._append(msg.data);
            this._requestPending = false;
        } else if (msg.type === 'reset') {
            this._readIndex = 0;
            this._writeIndex = 0;
            this._requestPending = false;
        }
    }

    _append(data) {
        if (!data || data.length === 0) return;
        const pending = this._writeIndex - this._readIndex;
        // 需保证 _writeIndex + data.length <= buffer.length；
        // 前部有未消费采样时，尾部空间可能不足，先压缩到开头再扩容。
        if (this._writeIndex + data.length > this._buffer.length) {
            if (pending > 0) {
                this._buffer.copyWithin(0, this._readIndex, this._writeIndex);
            }
            this._readIndex = 0;
            this._writeIndex = pending;
            if (this._writeIndex + data.length > this._buffer.length) {
                let size = Math.max(this._buffer.length || 1024, this._lowWatermark);
                while (size < this._writeIndex + data.length) size *= 2;
                const grown = new Float32Array(size);
                grown.set(this._buffer.subarray(0, this._writeIndex));
                this._buffer = grown;
            }
        }
        this._buffer.set(data, this._writeIndex);
        this._writeIndex += data.length;
    }

    process(inputs, outputs) {
        const out = outputs[0];
        if (!out || out.length === 0) return true;
        const channels = out.length;
        const frames = out[0].length;
        let played = 0;

        for (let i = 0; i < frames; i++) {
            if (this._pending() >= 2) {
                const left = this._buffer[this._readIndex++];
                const right = this._buffer[this._readIndex++];
                out[0][i] = left;
                if (channels > 1) out[1][i] = right;
                played++;
            } else {
                for (let c = 0; c < channels; c++) out[c][i] = 0;
            }
        }

        if (played > 0) {
            this.port.postMessage({ type: 'played', count: played });
        }
        if (this._pending() < this._lowWatermark && !this._requestPending) {
            this._requestPending = true;
            this.port.postMessage({ type: 'request' });
        }
        return true;
    }
}

registerProcessor('tabforge-synth-output', TabForgeSynthProcessor);
