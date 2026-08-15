/**
 * uiStore — UI 状态管理
 *
 * 管理编辑器的 UI 状态：技法、和弦输入、琶音等。
 */

export const uiStore = {
    /** 当前技法 */
    currentTechnique: 'none' as 'none' | 'hammerOn' | 'pullOff' | 'slide' | 'bend' | 'vibrato',
    /** 延音按钮是否激活 */
    tieActive: false,

    /** 推弦幅度（半音数）: 0.25=1/4, 0.5=1/2, 1=Full */
    bendAmount: 1 as number,
    /** 推弦后是否释放回来 */
    bendRelease: false,

    /** 和弦输入：各弦当前选择的品位 (-1 = 不弹) */
    currentChordFrets: [-1, -1, -1, -1, -1, -1] as number[],

    /** 琶音方向 */
    currentArpeggio: '' as '' | 'up' | 'down',
    /** 扫弦方向 */
    currentStrum: '' as '' | 'up' | 'down',

    // 播放状态
    playbackState: 'idle' as 'idle' | 'playing' | 'paused' | 'stopped',

    // ============================================================
    // Actions
    // ============================================================

    /** 设置技法 */
    setTechnique(tech: 'none' | 'hammerOn' | 'pullOff' | 'slide' | 'bend' | 'vibrato'): void {
        this.currentTechnique = tech;
    },

    /** 切换延音标记 */
    toggleTie(): void {
        this.tieActive = !this.tieActive;
    },

    /** 切换琶音方向: '' → 'up' → 'down' → '' */
    cycleArpeggio(): void {
        if (this.currentArpeggio === '') {
            this.currentArpeggio = 'up';
        } else if (this.currentArpeggio === 'up') {
            this.currentArpeggio = 'down';
        } else {
            this.currentArpeggio = '';
        }
    },

    /** 重置琶音 */
    resetArpeggio(): void {
        this.currentArpeggio = '';
    },

    /** 切换扫弦方向 */
    toggleStrum(): void {
        if (this.currentStrum === '') {
            this.currentStrum = 'down';
        } else if (this.currentStrum === 'down') {
            this.currentStrum = 'up';
        } else {
            this.currentStrum = '';
        }
    },

    /** 重置扫弦 */
    resetStrum(): void {
        this.currentStrum = '';
    },

    /** 设置和弦指法 */
    setChordFrets(frets: number[]): void {
        this.currentChordFrets = [...frets];
    },

    /** 设置某根弦的品位 */
    setChordFret(stringIdx: number, fret: number): void {
        this.currentChordFrets[stringIdx] = fret;
    },

    /** 重置和弦选择 */
    resetChordFrets(): void {
        this.currentChordFrets = [-1, -1, -1, -1, -1, -1];
    },
};
