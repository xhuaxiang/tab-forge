/**
 * 渲染常量 — 六线谱 Canvas 渲染所用的颜色和布局常量
 */

// ============================================================
// 颜色方案
// ============================================================

export const COLORS = {
    bg: '#0f0f23',
    line: '#3a3a5a',
    lineDim: '#505081',
    text: '#aaa',
    textDim: '#999',
    textBright: '#eee',
    accent: '#f7971e',
    string1: '#e74c3c',
    string2: '#e67e22',
    string3: '#f1c40f',
    string4: '#2ecc71',
    string5: '#3498db',
    string6: '#9b59b6',
    barline: '#555',
    noteBg: '#1a1a2e',
    durationLine: 'rgba(150,150,150,0.5)',
    beamFill: 'rgba(150,150,150,0.25)',
};

export const STRING_COLORS: Record<number, string> = {
    1: COLORS.string1,
    2: COLORS.string2,
    3: COLORS.string3,
    4: COLORS.string4,
    5: COLORS.string5,
    6: COLORS.string6,
};

// ============================================================
// 布局常量
// ============================================================

export const LAYOUT = {
    paddingLeft: 40,
    paddingRight: 20,
    paddingTop: 50,
    paddingBottom: 48,
    /** 弦间距（垂直） */
    lineSpacing: 18,
    /** 默认音符间距（水平） */
    noteSpacing: 26,
    /** 最小音符间距（低于此值则强制换行，允许适度压缩但不过度） */
    minNoteSpacing: 20,
    /** 小节间额外间距 */
    measureGap: 14,
    /** 弦标签宽度 */
    stringLabelWidth: 28,
    /** 音符背景圆半径 */
    noteRadius: 7,
    /** 符尾长度 */
    flagHeight: 16,
    /** 符干线宽 */
    stemWidth: 1.2,
    /** 符干高度（从第6弦向下延伸） */
    stemHeight: 22,
    /** 行间距（换行后两行六线谱之间的垂直距离，不含谱线高度） */
    rowGap: 56,
    /** 每行最小音符数（用于控制行密度） */
    minNotesPerRow: 2,
    fontSize: {
        stringLabel: 11,
        fret: 11,
        timeSig: 11,
        measureNum: 10,
        info: 11,
        title: 16,
        durationLabel: 9,
    },
};
