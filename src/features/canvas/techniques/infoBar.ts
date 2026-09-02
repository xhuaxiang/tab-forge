/**
 * 顶部信息栏 + 空状态渲染
 */

import { COLORS, LAYOUT } from '../constants.ts';

/**
 * 渲染顶部信息栏（标题、艺术家、调弦、BPM）
 */
export function renderInfoBar(
    ctx: CanvasRenderingContext2D,
    title: string,
    artist: string,
    tuning: { string1: string; string2: string; string3: string; string4: string; string5: string; string6: string },
    bpm: number,
): void {
    ctx.save();
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `${LAYOUT.fontSize.info}px sans-serif`;

    let infoText = `调弦: ${tuning.string6} ${tuning.string5} ${tuning.string4} ${tuning.string3} ${tuning.string2} ${tuning.string1}`;
    if (title) infoText = `${title}${artist ? ' - ' + artist : ''}  |  ` + infoText;
    infoText += `  |  BPM: ${bpm}`;

    ctx.textAlign = 'left';
    ctx.fillText(infoText, LAYOUT.paddingLeft, LAYOUT.paddingTop -32);
    ctx.restore();
}

/**
 * 渲染空状态（乐谱无内容时显示）
 */
export function renderEmptyState(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
): void {
    ctx.save();
    ctx.fillStyle = COLORS.textDim;
    ctx.textAlign = 'center';
    ctx.font = '13px sans-serif';
    ctx.fillText('暂无内容 — 点击「添加小节」开始', width / 2, height / 2 - 10);

    ctx.fillStyle = COLORS.textDim;
    ctx.font = '11px sans-serif';
    ctx.fillText('提示：数字 = 品位，0 = 空弦，- = 不弹', width / 2, height / 2 + 16);
    ctx.restore();
}
