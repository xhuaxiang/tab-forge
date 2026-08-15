/**
 * chordInput — 和弦输入组件
 *
 * 管理和弦指法网格、预设按钮的 UI 交互。
 * 状态存储在 uiStore 中。
 */

import { uiStore } from './stores/uiStore.ts';

// ============================================================
// 和弦预设
// ============================================================

export const CHORD_PRESETS: { name: string; frets: number[] }[] = [
    // frets 索引 0=1弦(高音E) → 5=6弦(低音E)
    { name: 'Am', frets: [0, 1, 2, 2, 0, -1] },   // x02210
    { name: 'C',  frets: [0, 1, 0, 2, 3, -1] },   // x32010
    { name: 'G',  frets: [3, 0, 0, 0, 2, 3] },    // 320003
    { name: 'Em', frets: [0, 0, 0, 2, 2, 0] },    // 022000
    { name: 'D',  frets: [2, 3, 2, 0, -1, -1] },  // xx0232
    { name: 'A',  frets: [0, 2, 2, 2, 0, -1] },   // x02220
    { name: 'F',  frets: [1, 1, 2, 3, 3, 1] },    // 133211
    { name: 'E',  frets: [0, 0, 1, 2, 2, 0] },    // 022100
    { name: 'Dm', frets: [1, 3, 2, 0, -1, -1] },  // xx0231
];

// ============================================================
// 和弦网格初始化
// ============================================================

/**
 * 初始化和弦指法网格
 * 生成 6弦 × 6品的可点击网格
 */
export function initChordGrid(): void {
    const cc = document.getElementById('chordGridCells');
    if (!cc) return;
    cc.innerHTML = '';
    for (let s = 0; s < 6; s++) {
        for (let f = 0; f <= 5; f++) {
            const cell = document.createElement('div');
            cell.className = 'chord-grid-cell';
            cell.dataset.string = String(s + 1);
            cell.dataset.fret = String(f);
            cell.textContent = String(f);
            cell.addEventListener('click', () => {
                const prev = cc.querySelector(`.chord-grid-cell[data-string="${s + 1}"].selected`);
                if (prev) prev.classList.remove('selected');
                if (uiStore.currentChordFrets[s] === f) {
                    uiStore.setChordFret(s, -1);
                    return;
                }
                cell.classList.add('selected');
                uiStore.setChordFret(s, f);
            });
            cc.appendChild(cell);
        }
    }
    const cp = document.querySelector('.chord-presets') as HTMLElement
    let cpHtml = ''
    for (const item of  CHORD_PRESETS) {
        cpHtml += `<button class="preset-btn" data-chord="${item.frets}" title="${item.name}">${item.name}</button>`
    }
    cp.innerHTML = cpHtml

}

/**
 * 更新扫弦按钮的 UI 状态
 */
export function updateStrumButton(): void {
    const btn = document.getElementById('strumToggle');
    if (!btn) return;
    const s = uiStore.currentStrum;
    if (s === 'down') {
        btn.textContent = '⤵ 下扫';
        btn.classList.add('active');
    } else if (s === 'up') {
        btn.textContent = '⤴ 上扫';
        btn.classList.add('active');
    } else {
        btn.textContent = '⤵ 扫弦';
        btn.classList.remove('active');
    }
}

/**
 * 更新琶音按钮的 UI 状态
 */
export function updateArpeggioButton(): void {
    const btn = document.getElementById('arpeggioToggle');
    if (!btn) return;
    const s = uiStore.currentArpeggio;
    if (s === 'up') {
        btn.textContent = '𝆃 ↑';
        btn.classList.add('active');
    } else if (s === 'down') {
        btn.textContent = '𝆃 ↓';
        btn.classList.add('active');
    } else {
        btn.textContent = '𝆃 琶音';
        btn.classList.remove('active');
    }
}
