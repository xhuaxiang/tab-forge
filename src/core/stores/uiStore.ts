/**
 * uiStore — UI 状态管理
 *
 * 管理编辑器的 UI 状态：技法、和弦输入、琶音等。
 */

import type { AppTechnique, AppHarmonic, NoteArticulation, PlaybackState } from '../types/index.ts';
import { DEFAULT_HARMONIC_FRET, HARMONIC_FRET_MIN, HARMONIC_FRET_MAX } from '../config.ts';

export const uiStore = {
    /** 当前技法 */
    currentTechnique: 'none' as AppTechnique,
    /** 延音按钮是否激活 */
    tieActive: false,

    /** 当前奏法开关（与 currentTechnique 正交，可同时开启） */
    currentArticulations: {
        palmMute: false,
        deadNote: false,
        letRing: false,
        staccato: false,
    },
    /** 当前泛音类型（'' = 无） */
    currentHarmonic: '' as '' | AppHarmonic,
    /** 人工/捏弦泛音的触弦点（品位差） */
    harmonicFret: DEFAULT_HARMONIC_FRET as number,

    /** 推弦幅度（以全音为单位）: 0.25=1/4 全音, 0.5=半音, 1=全音。单位与 Note.bendAmount 一致 */
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
    playbackState: 'idle' as PlaybackState,

    // ============================================================
    // Actions
    // ============================================================

    /** 设置技法 */
    setTechnique(tech: AppTechnique): void {
        this.currentTechnique = tech;
    },

    /** 设置单个奏法开关 */
    setArticulation(name: NoteArticulation, active: boolean): void {
        this.currentArticulations[name] = active;
    },

    /** 设置泛音类型（'' = 关闭） */
    setHarmonic(harmonic: '' | AppHarmonic): void {
        this.currentHarmonic = harmonic;
    },

    /** 设置人工/捏弦泛音的触弦点（相对按弦位置的品位差，夹到 1-24） */
    setHarmonicFret(fret: number): void {
        const rounded = Math.round(fret);
        this.harmonicFret = Number.isFinite(rounded)
            ? Math.min(HARMONIC_FRET_MAX, Math.max(HARMONIC_FRET_MIN, rounded))
            : DEFAULT_HARMONIC_FRET;
    },

    // 设置型动作：延音/推弦的状态来源是 DOM（按钮 class）与表单回填，
    // 不是「切换」语义，故提供 set 而非 toggle。
    /** 设置延音标记 */
    setTie(active: boolean): void {
        this.tieActive = active;
    },

    /** 设置推弦幅度（以全音为单位，见 Note.bendAmount） */
    setBendAmount(amount: number): void {
        this.bendAmount = amount;
    },

    /** 设置推弦后是否释放 */
    setBendRelease(on: boolean): void {
        this.bendRelease = on;
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
