import { COLORS, LAYOUT } from '../constants.ts';
import { drawArc } from '../draw/arc.ts';
import { drawText } from '../draw/text.ts';

/** 连音乐句类型 */
export type SlurType = 'hammerOn' | 'pullOff' | 'slide' | 'tie';

/** 技法标签映射 */
const SLUR_LABELS: Record<SlurType, string> = {
    hammerOn: 'H',
    pullOff: 'P',
    slide: 'S',
    tie: '',
};

/** 弧线颜色：延音用淡色，技法用高亮色 */
const SLUR_COLORS: Record<SlurType, string> = {
    hammerOn: COLORS.accent,
    pullOff: COLORS.accent,
    slide: COLORS.accent,
    tie: COLORS.durationLine,
};

export interface SlurOptions {
    /** 连音类型 */
    type: SlurType;
    /** 是否在弧线中央标技法字母（tie 类型自动不标） */
    showLabel?: boolean;
    /** 技法目标品位（有值时在弧线终点旁边绘制品位数字） */
    targetFret?: number;
}

/**
 * 渲染连音乐句弧线
 *
 * @param ctx     Canvas 上下文
 * @param x1      起始音符 X 坐标
 * @param x2      目标音符 X 坐标
 * @param y       基线 Y（弧线从此高度弯曲）
 * @param options 连音选项
 */
export function renderSlur(
    ctx: CanvasRenderingContext2D,
    x1: number,
    x2: number,
    y: number,
    options: SlurOptions,
): void {
    const { type, showLabel = true, targetFret } = options;
    const midX = (x1 + x2) / 2;
    const bendOffset = -(LAYOUT.lineSpacing * 0.6);
    const midY = y + bendOffset;

    drawArc(ctx, x1, x2, y, {
        color: SLUR_COLORS[type],
        lineWidth: 1.5,
        bendOffset,
    });

    // 标技法字母
    const label = SLUR_LABELS[type];
    if (label && showLabel) {
        drawText(ctx, label, midX, midY - LAYOUT.fontSize.fret * 0.4, {
            color: SLUR_COLORS[type],
            font: `bold ${LAYOUT.fontSize.fret}px monospace`,
        });
    }

    // 在终点右侧绘制目标品位数字（技法专用）
    if (targetFret !== undefined && type !== 'tie') {
        drawText(ctx, String(targetFret), x2 + 4, y + 4, {
            color: COLORS.textDim,
            font: `bold ${LAYOUT.fontSize.fret + 1}px monospace`,
            align: 'left',
        });
    }
}

