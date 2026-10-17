/**
 * uiStore 单元测试
 *
 * uiStore 只装 UI 临时态，动作全部是同步赋值/回环，
 * 不涉及 DOM 与 AudioContext。每个用例前重置相关字段。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { uiStore } from '../../../core/stores/uiStore.ts';

beforeEach(() => {
    uiStore.currentTechnique = 'none';
    uiStore.tieActive = false;
    uiStore.bendAmount = 1;
    uiStore.bendRelease = false;
    uiStore.currentChordFrets = [-1, -1, -1, -1, -1, -1];
    uiStore.currentArpeggio = '';
    uiStore.currentStrum = '';
    uiStore.playbackState = 'idle';
});

describe('cycleArpeggio', () => {
    it("完整回环：'' → 'up' → 'down' → ''", () => {
        expect(uiStore.currentArpeggio).toBe('');

        uiStore.cycleArpeggio();
        expect(uiStore.currentArpeggio).toBe('up');

        uiStore.cycleArpeggio();
        expect(uiStore.currentArpeggio).toBe('down');

        uiStore.cycleArpeggio();
        expect(uiStore.currentArpeggio).toBe('');
    });

    it('回到空后再次切换重新开始', () => {
        uiStore.cycleArpeggio();
        uiStore.cycleArpeggio();
        uiStore.cycleArpeggio();

        uiStore.cycleArpeggio();

        expect(uiStore.currentArpeggio).toBe('up');
    });
});

describe('resetArpeggio', () => {
    it("从 'down' 重置为 ''", () => {
        uiStore.currentArpeggio = 'down';

        uiStore.resetArpeggio();

        expect(uiStore.currentArpeggio).toBe('');
    });

    it("本来就是 '' 时保持 ''", () => {
        uiStore.resetArpeggio();

        expect(uiStore.currentArpeggio).toBe('');
    });
});

describe('toggleStrum', () => {
    it("完整回环：'' → 'down' → 'up' → ''", () => {
        expect(uiStore.currentStrum).toBe('');

        uiStore.toggleStrum();
        expect(uiStore.currentStrum).toBe('down');

        uiStore.toggleStrum();
        expect(uiStore.currentStrum).toBe('up');

        uiStore.toggleStrum();
        expect(uiStore.currentStrum).toBe('');
    });
});

describe('resetStrum', () => {
    it("从 'up' 重置为 ''", () => {
        uiStore.currentStrum = 'up';

        uiStore.resetStrum();

        expect(uiStore.currentStrum).toBe('');
    });

    it("本来就是 '' 时保持 ''", () => {
        uiStore.resetStrum();

        expect(uiStore.currentStrum).toBe('');
    });
});

describe('setChordFrets', () => {
    it('写入全部 6 根弦的品位', () => {
        uiStore.setChordFrets([0, 1, 2, 3, 4, 5]);

        expect(uiStore.currentChordFrets).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('写入的是副本：之后修改传入数组不影响 store', () => {
        const frets = [0, 1, 2, 3, 4, 5];

        uiStore.setChordFrets(frets);
        frets[0] = 12;
        frets.push(7);

        expect(uiStore.currentChordFrets).toEqual([0, 1, 2, 3, 4, 5]);
        expect(uiStore.currentChordFrets).not.toBe(frets);
    });
});

describe('setChordFret', () => {
    it('只改指定索引，其余保持 -1', () => {
        uiStore.setChordFret(2, 5);

        expect(uiStore.currentChordFrets).toEqual([-1, -1, 5, -1, -1, -1]);
    });

    it('首尾索引都能写入', () => {
        uiStore.setChordFret(0, 3);
        uiStore.setChordFret(5, 7);

        expect(uiStore.currentChordFrets).toEqual([3, -1, -1, -1, -1, 7]);
    });
});

describe('resetChordFrets', () => {
    it('恢复为 6 个 -1', () => {
        uiStore.currentChordFrets = [0, 1, 2, 3, 4, 5];

        uiStore.resetChordFrets();

        expect(uiStore.currentChordFrets).toEqual([-1, -1, -1, -1, -1, -1]);
        expect(uiStore.currentChordFrets).toHaveLength(6);
    });
});

describe('setTechnique', () => {
    it('写入技法', () => {
        uiStore.setTechnique('bend');
        expect(uiStore.currentTechnique).toBe('bend');

        uiStore.setTechnique('hammerOn');
        expect(uiStore.currentTechnique).toBe('hammerOn');

        uiStore.setTechnique('none');
        expect(uiStore.currentTechnique).toBe('none');
    });
});

describe('setTie', () => {
    it('直接赋值 true / false', () => {
        uiStore.setTie(true);
        expect(uiStore.tieActive).toBe(true);

        uiStore.setTie(false);
        expect(uiStore.tieActive).toBe(false);
    });
});

describe('setBendAmount', () => {
    it('直接赋值推弦幅度', () => {
        uiStore.setBendAmount(0.25);
        expect(uiStore.bendAmount).toBe(0.25);

        uiStore.setBendAmount(0.5);
        expect(uiStore.bendAmount).toBe(0.5);

        uiStore.setBendAmount(1);
        expect(uiStore.bendAmount).toBe(1);
    });
});

describe('setBendRelease', () => {
    it('直接赋值推弦释放标记', () => {
        uiStore.setBendRelease(true);
        expect(uiStore.bendRelease).toBe(true);

        uiStore.setBendRelease(false);
        expect(uiStore.bendRelease).toBe(false);
    });
});
