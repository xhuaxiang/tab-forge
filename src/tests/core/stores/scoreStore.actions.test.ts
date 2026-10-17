/**
 * scoreStore 动作单元测试
 *
 * scoreStore 是单例，每个用例前完整重置状态。
 * 覆盖：小节导航/选中、小节增删清空、音符与休止符写入、
 * loadNotes 的切小节/和弦拍位/批量通知、原位修改/静音、
 * 调弦/BPM/调性/拍号写入，以及批量通知与回调注入。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scoreStore } from '../../../core/stores/scoreStore.ts';
import { SCORE_DEFAULTS } from '../../../core/config.ts';
import type { Measure, Note, Tuning } from '../../../core/types/index.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[], num = 4, den = 4, index = 0): Measure {
    return { index, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

/** 生成 count 个四分音符（单音，各自成组） */
function quarters(count: number): Note[] {
    return Array.from({ length: count }, () => note({ duration: 0.25 }));
}

beforeEach(() => {
    scoreStore.score.measures = [];
    scoreStore.score.tuning = { ...SCORE_DEFAULTS.tuning };
    scoreStore.score.bpm = SCORE_DEFAULTS.bpm;
    scoreStore.score.key = SCORE_DEFAULTS.key;
    scoreStore.score.timeSignature = SCORE_DEFAULTS.timeSignature;
    scoreStore.selectedMeasure = null;
    scoreStore.onChange = null;
    scoreStore.onSelectChange = null;
    scoreStore._batchDepth = 0;
});

// ============================================================
// 小节导航与选中
// ============================================================

describe('activeMeasureIndex', () => {
    it('空谱返回 0', () => {
        expect(scoreStore.activeMeasureIndex()).toBe(0);
    });

    it('无选中返回末尾小节索引', () => {
        scoreStore.score.measures = [measure([]), measure([]), measure([])];
        expect(scoreStore.activeMeasureIndex()).toBe(2);
    });

    it('有选中时返回选中值', () => {
        scoreStore.score.measures = [measure([]), measure([]), measure([])];
        scoreStore.selectedMeasure = 1;
        expect(scoreStore.activeMeasureIndex()).toBe(1);
    });

    it('选中值为负数时钳制到 0', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        scoreStore.selectedMeasure = -3;
        expect(scoreStore.activeMeasureIndex()).toBe(0);
    });

    it('选中值超过末尾时钳制到末尾索引', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        scoreStore.selectedMeasure = 99;
        expect(scoreStore.activeMeasureIndex()).toBe(1);
    });
});

describe('selectMeasure', () => {
    it('空谱传任意值都返回 null 且不选中', () => {
        expect(scoreStore.selectMeasure(3)).toBeNull();
        expect(scoreStore.selectedMeasure).toBeNull();
    });

    it('正常选中并触发一次 onSelectChange', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        const onSelect = vi.fn();
        scoreStore.onSelectChange = onSelect;

        expect(scoreStore.selectMeasure(1)).toBe(1);
        expect(scoreStore.selectedMeasure).toBe(1);
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('重复选同一小节不再触发 onSelectChange', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        scoreStore.selectedMeasure = 1;
        const onSelect = vi.fn();
        scoreStore.onSelectChange = onSelect;

        expect(scoreStore.selectMeasure(1)).toBe(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('越界正数被钳制到末尾索引', () => {
        scoreStore.score.measures = [measure([]), measure([]), measure([])];
        expect(scoreStore.selectMeasure(99)).toBe(2);
        expect(scoreStore.selectedMeasure).toBe(2);
    });

    it('负数被钳制到 0', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        expect(scoreStore.selectMeasure(-4)).toBe(0);
        expect(scoreStore.selectedMeasure).toBe(0);
    });

    it('传 null 取消选中并触发一次 onSelectChange', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        scoreStore.selectedMeasure = 1;
        const onSelect = vi.fn();
        scoreStore.onSelectChange = onSelect;

        expect(scoreStore.selectMeasure(null)).toBeNull();
        expect(scoreStore.selectedMeasure).toBeNull();
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('本来就未选中时传 null 不触发 onSelectChange', () => {
        scoreStore.score.measures = [measure([])];
        const onSelect = vi.fn();
        scoreStore.onSelectChange = onSelect;

        expect(scoreStore.selectMeasure(null)).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
    });
});

// ============================================================
// 活动小节与增删清空
// ============================================================

describe('getActiveMeasure', () => {
    it('空谱自动创建一个小节，拍号取全局拍号，且 selectedMeasure 为 null', () => {
        scoreStore.score.timeSignature = '3/4';

        const m = scoreStore.getActiveMeasure();

        expect(scoreStore.score.measures).toHaveLength(1);
        expect(scoreStore.score.measures[0]).toBe(m);
        expect(m.index).toBe(0);
        expect(m.notes).toEqual([]);
        expect(m.timeSignatureNumerator).toBe(3);
        expect(m.timeSignatureDenominator).toBe(4);
        expect(scoreStore.selectedMeasure).toBeNull();
    });

    it('空谱自动建小节不触发 onChange', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.getActiveMeasure();

        expect(onChange).not.toHaveBeenCalled();
    });

    it('非空谱返回选中的小节', () => {
        const a = measure([], 4, 4, 0);
        const b = measure([], 4, 4, 1);
        scoreStore.score.measures = [a, b];
        scoreStore.selectedMeasure = 1;

        expect(scoreStore.getActiveMeasure()).toBe(b);
    });

    it('非空谱无选中时返回末尾小节', () => {
        const a = measure([], 4, 4, 0);
        const b = measure([], 4, 4, 1);
        scoreStore.score.measures = [a, b];
        scoreStore.selectedMeasure = null;

        expect(scoreStore.getActiveMeasure()).toBe(b);
    });
});

describe('addMeasure', () => {
    it('空谱添加返回 1（1-based）', () => {
        expect(scoreStore.addMeasure()).toBe(1);
        expect(scoreStore.score.measures).toHaveLength(1);
    });

    it('已有小节时返回递增的 1-based 序号', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        expect(scoreStore.addMeasure()).toBe(3);
        expect(scoreStore.score.measures).toHaveLength(3);
    });

    it('新小节拍号取当前全局拍号', () => {
        scoreStore.score.timeSignature = '6/8';

        scoreStore.addMeasure();

        const m = scoreStore.score.measures[0];
        expect(m.timeSignatureNumerator).toBe(6);
        expect(m.timeSignatureDenominator).toBe(8);
    });

    it('触发一次 onChange', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.addMeasure();

        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('deleteLastMeasure', () => {
    it('空谱返回 false 且不通知', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        expect(scoreStore.deleteLastMeasure()).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('正常删除末尾小节并触发一次通知', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        expect(scoreStore.deleteLastMeasure()).toBe(true);
        expect(scoreStore.score.measures).toHaveLength(1);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('选中索引在删除后越界时被清空', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        scoreStore.selectedMeasure = 1;

        scoreStore.deleteLastMeasure();

        expect(scoreStore.selectedMeasure).toBeNull();
    });

    it('选中索引未越界时保留', () => {
        scoreStore.score.measures = [measure([]), measure([]), measure([])];
        scoreStore.selectedMeasure = 0;

        scoreStore.deleteLastMeasure();

        expect(scoreStore.score.measures).toHaveLength(2);
        expect(scoreStore.selectedMeasure).toBe(0);
    });
});

describe('clear', () => {
    it('清空小节、取消选中并触发一次通知', () => {
        scoreStore.score.measures = [measure([note({ duration: 0.25 })]), measure([])];
        scoreStore.selectedMeasure = 1;
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.clear();

        expect(scoreStore.score.measures).toEqual([]);
        expect(scoreStore.selectedMeasure).toBeNull();
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// 音符 / 休止符写入
// ============================================================

describe('addNote', () => {
    it('追加到活动小节（无选中时为末尾小节）', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        const n = note({ duration: 0.25, string: 2, fret: 3 });

        scoreStore.addNote(n);

        expect(scoreStore.score.measures[0].notes).toHaveLength(0);
        expect(scoreStore.score.measures[1].notes).toEqual([n]);
    });

    it('追加到选中的小节', () => {
        scoreStore.score.measures = [measure([]), measure([])];
        scoreStore.selectedMeasure = 0;
        const n = note({ duration: 0.5, string: 4, fret: 5 });

        scoreStore.addNote(n);

        expect(scoreStore.score.measures[0].notes).toEqual([n]);
        expect(scoreStore.score.measures[1].notes).toHaveLength(0);
    });

    it('空谱时自动建小节再追加，且只通知一次', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;
        const n = note({ duration: 0.25 });

        scoreStore.addNote(n);

        expect(scoreStore.score.measures).toHaveLength(1);
        expect(scoreStore.score.measures[0].notes).toEqual([n]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('addRest', () => {
    it('追加 { isRest: true, duration }', () => {
        scoreStore.score.measures = [measure([])];

        scoreStore.addRest(0.5);

        expect(scoreStore.score.measures[0].notes).toEqual([
            { isRest: true, duration: 0.5 },
        ]);
    });

    it('空谱时自动建小节再追加', () => {
        scoreStore.addRest(0.25);

        expect(scoreStore.score.measures).toHaveLength(1);
        expect(scoreStore.score.measures[0].notes[0]).toEqual({ isRest: true, duration: 0.25 });
    });

    it('触发一次 onChange', () => {
        scoreStore.score.measures = [measure([])];
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.addRest(0.25);

        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// loadNotes
// ============================================================

describe('loadNotes', () => {
    it('4 个四分音符 → 1 个小节 4 个音符，返回 4', () => {
        const written = scoreStore.loadNotes(quarters(4), 1);

        expect(written).toBe(4);
        expect(scoreStore.score.measures).toHaveLength(1);
        expect(scoreStore.score.measures[0].notes).toHaveLength(4);
    });

    it('8 个四分音符 → 自动切出 2 个小节，返回 8', () => {
        const written = scoreStore.loadNotes(quarters(8), 1);

        expect(written).toBe(8);
        expect(scoreStore.score.measures).toHaveLength(2);
        expect(scoreStore.score.measures[0].notes).toHaveLength(4);
        expect(scoreStore.score.measures[1].notes).toHaveLength(4);
    });

    it('共享 chordGroup 的连续音符按一个拍位计容量', () => {
        const notes: Note[] = [
            note({ duration: 0.25, chordGroup: 42, string: 1 }),
            note({ duration: 0.25, chordGroup: 42, string: 2 }),
            note({ duration: 0.25, string: 3 }),
            note({ duration: 0.25, string: 4 }),
            note({ duration: 0.25, string: 5 }),
        ];

        const written = scoreStore.loadNotes(notes, 1);

        expect(written).toBe(5);
        expect(scoreStore.score.measures).toHaveLength(1);
        expect(scoreStore.score.measures[0].notes).toHaveLength(5);
    });

    it('minMeasures 补足小节数（音符很少也补到指定数）', () => {
        const written = scoreStore.loadNotes([note({ duration: 0.25 })], 3);

        expect(written).toBe(1);
        expect(scoreStore.score.measures).toHaveLength(3);
        expect(scoreStore.score.measures[0].notes).toHaveLength(1);
        expect(scoreStore.score.measures[1].notes).toHaveLength(0);
        expect(scoreStore.score.measures[2].notes).toHaveLength(0);
    });

    it('休止符 slot 走 addRest，返回计数正确', () => {
        const notes: Note[] = [
            note({ duration: 0.25 }),
            { isRest: true, duration: 0.25 },
            note({ duration: 0.25 }),
        ];

        const written = scoreStore.loadNotes(notes, 1);

        expect(written).toBe(3);
        const writtenNotes = scoreStore.score.measures[0].notes;
        expect(writtenNotes).toHaveLength(3);
        expect(writtenNotes[1]).toEqual({ isRest: true, duration: 0.25 });
    });

    it('和弦 slot 内同弦重复只写第一个，返回计数只算实际写入', () => {
        const notes: Note[] = [
            note({ duration: 0.25, chordGroup: 7, string: 1, fret: 0 }),
            note({ duration: 0.25, chordGroup: 7, string: 1, fret: 5 }),
        ];

        const written = scoreStore.loadNotes(notes, 1);

        expect(written).toBe(1);
        expect(scoreStore.score.measures[0].notes).toHaveLength(1);
        expect(scoreStore.score.measures[0].notes[0].fret).toBe(0);
    });

    it('先清空旧谱再重建', () => {
        scoreStore.score.measures = [measure([note({ duration: 1 })])];
        scoreStore.selectedMeasure = 0;

        scoreStore.loadNotes(quarters(2), 1);

        expect(scoreStore.score.measures).toHaveLength(1);
        expect(scoreStore.score.measures[0].notes).toHaveLength(2);
        expect(scoreStore.selectedMeasure).toBeNull();
    });

    it('批量通知：全程只触发一次 onChange', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.loadNotes(quarters(8), 1);

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('loadNotes([], 2) → 2 个空小节、返回 0、通知一次', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        const written = scoreStore.loadNotes([], 2);

        expect(written).toBe(0);
        expect(scoreStore.score.measures).toHaveLength(2);
        expect(scoreStore.score.measures[0].notes).toEqual([]);
        expect(scoreStore.score.measures[1].notes).toEqual([]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// 原位修改 / 静音
// ============================================================

describe('updateNoteAt', () => {
    it('小节不存在 → ok:false 且原因为「小节不存在」', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        const r = scoreStore.updateNoteAt(0, 0, note({ duration: 0.25 }));

        expect(r.ok).toBe(false);
        expect(r.reason).toBe('小节不存在');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('单音拍整拍替换，保留原拍时值并清除 chordGroup', () => {
        const old = note({ duration: 0.25, string: 1, fret: 0 });
        scoreStore.score.measures = [measure([old])];
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        const r = scoreStore.updateNoteAt(0, 0, note({ duration: 0.5, string: 2, fret: 7 }));

        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(1);
        expect(notes[0]).not.toBe(old);
        expect(notes[0].string).toBe(2);
        expect(notes[0].fret).toBe(7);
        expect(notes[0].duration).toBe(0.25); // 保留原拍时值
        expect(notes[0].chordGroup).toBeUndefined();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('和弦内替换单根弦，保留组时值与 chordGroup', () => {
        scoreStore.score.measures = [measure([
            note({ duration: 0.25, chordGroup: 9, string: 1, fret: 0 }),
            note({ duration: 0.25, chordGroup: 9, string: 2, fret: 1 }),
        ])];
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        const r = scoreStore.updateNoteAt(0, 1, note({ duration: 0.5, string: 2, fret: 5, technique: 'slide' }));

        expect(r.ok).toBe(true);
        const notes = scoreStore.score.measures[0].notes;
        expect(notes).toHaveLength(2);
        expect(notes[1].string).toBe(2);
        expect(notes[1].fret).toBe(5);
        expect(notes[1].technique).toBe('slide');
        expect(notes[1].duration).toBe(0.25); // 对齐组时值
        expect(notes[1].chordGroup).toBe(9);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('和弦内换成已占用的弦 → 失败且不通知', () => {
        scoreStore.score.measures = [measure([
            note({ duration: 0.25, chordGroup: 9, string: 1, fret: 0 }),
            note({ duration: 0.25, chordGroup: 9, string: 2, fret: 1 }),
        ])];
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        const r = scoreStore.updateNoteAt(0, 1, note({ duration: 0.25, string: 1, fret: 5 }));

        expect(r.ok).toBe(false);
        expect(r.reason).toBe('和弦内该弦已有音符');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('音符下标不存在 → 失败且原因为「目标音符不存在」', () => {
        scoreStore.score.measures = [measure([note({ duration: 0.25 })])];

        const r = scoreStore.updateNoteAt(0, 5, note({ duration: 0.25 }));

        expect(r.ok).toBe(false);
        expect(r.reason).toBe('目标音符不存在');
    });
});

describe('muteNoteAt', () => {
    it('小节不存在 → ok:false 且原因为「小节不存在」', () => {
        const r = scoreStore.muteNoteAt(0, 0);

        expect(r.ok).toBe(false);
        expect(r.reason).toBe('小节不存在');
    });

    it('单音静音为同时值的休止符并通知', () => {
        scoreStore.score.measures = [measure([note({ duration: 0.5, string: 1, fret: 3 })])];
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        const r = scoreStore.muteNoteAt(0, 0);

        expect(r.ok).toBe(true);
        expect(scoreStore.score.measures[0].notes).toEqual([
            { isRest: true, duration: 0.5 },
        ]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('和弦整拍静音为一个同时值的休止符', () => {
        scoreStore.score.measures = [measure([
            note({ duration: 0.5, chordGroup: 3, string: 1, fret: 0 }),
            note({ duration: 0.5, chordGroup: 3, string: 2, fret: 2 }),
        ])];
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        const r = scoreStore.muteNoteAt(0, 1);

        expect(r.ok).toBe(true);
        expect(scoreStore.score.measures[0].notes).toEqual([
            { isRest: true, duration: 0.5 },
        ]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('目标本身就是休止符 → 仍返回成功且内容不变（通知一次）', () => {
        scoreStore.score.measures = [measure([{ isRest: true, duration: 0.25 }])];
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        const r = scoreStore.muteNoteAt(0, 0);

        expect(r.ok).toBe(true);
        expect(scoreStore.score.measures[0].notes).toEqual([{ isRest: true, duration: 0.25 }]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('音符下标不存在 → 失败且原因为「目标音符不存在」', () => {
        scoreStore.score.measures = [measure([note({ duration: 0.25 })])];

        const r = scoreStore.muteNoteAt(0, 9);

        expect(r.ok).toBe(false);
        expect(r.reason).toBe('目标音符不存在');
    });
});

// ============================================================
// 全局设置
// ============================================================

describe('setTuning', () => {
    it('写入调弦并触发通知', () => {
        const tuning: Tuning = {
            string1: 'D4', string2: 'A3', string3: 'F#3',
            string4: 'D3', string5: 'A2', string6: 'D2',
        };
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.setTuning(tuning);

        expect(scoreStore.score.tuning).toEqual(tuning);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('写入的是副本：修改传入对象不影响 store', () => {
        const tuning: Tuning = { ...SCORE_DEFAULTS.tuning };
        scoreStore.setTuning(tuning);

        tuning.string1 = 'CHANGED';

        expect(scoreStore.score.tuning.string1).toBe(SCORE_DEFAULTS.tuning.string1);
        expect(scoreStore.score.tuning).not.toBe(tuning);
    });
});

describe('setStringTuning', () => {
    it('只改指定弦，其余弦保持不变', () => {
        scoreStore.score.tuning = { ...SCORE_DEFAULTS.tuning };
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.setStringTuning(6, 'D2');

        expect(scoreStore.score.tuning.string6).toBe('D2');
        expect(scoreStore.score.tuning.string1).toBe(SCORE_DEFAULTS.tuning.string1);
        expect(scoreStore.score.tuning.string5).toBe(SCORE_DEFAULTS.tuning.string5);
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('setBpm', () => {
    it('正常值原样写入并通知', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.setBpm(120);

        expect(scoreStore.score.bpm).toBe(120);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('小于 20 钳制到 20', () => {
        scoreStore.setBpm(5);
        expect(scoreStore.score.bpm).toBe(20);
    });

    it('大于 300 钳制到 300', () => {
        scoreStore.setBpm(400);
        expect(scoreStore.score.bpm).toBe(300);
    });

    it('边界值 20 / 300 原样保留', () => {
        scoreStore.setBpm(20);
        expect(scoreStore.score.bpm).toBe(20);
        scoreStore.setBpm(300);
        expect(scoreStore.score.bpm).toBe(300);
    });
});

describe('setKey', () => {
    it('写入调性并通知', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.setKey('G');

        expect(scoreStore.score.key).toBe('G');
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('setTimeSignature', () => {
    it('更新全局拍号并同步到所有已存在小节', () => {
        scoreStore.score.measures = [
            measure([], 4, 4, 0),
            measure([], 4, 4, 1),
        ];
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.setTimeSignature('6/8');

        expect(scoreStore.score.timeSignature).toBe('6/8');
        for (const m of scoreStore.score.measures) {
            expect(m.timeSignatureNumerator).toBe(6);
            expect(m.timeSignatureDenominator).toBe(8);
        }
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('之后新增的小节也使用新拍号', () => {
        scoreStore.setTimeSignature('3/4');

        scoreStore.addMeasure();

        const m = scoreStore.score.measures[0];
        expect(m.timeSignatureNumerator).toBe(3);
        expect(m.timeSignatureDenominator).toBe(4);
    });
});

// ============================================================
// 批量通知与回调注入
// ============================================================

describe('beginBatch / endBatch', () => {
    it('嵌套 batch 期间不通知，归零时只通知一次', () => {
        const onChange = vi.fn();
        scoreStore.onChange = onChange;

        scoreStore.beginBatch();
        scoreStore.beginBatch();
        expect(scoreStore._batchDepth).toBe(2);

        scoreStore.addMeasure(); // depth 2：静默
        scoreStore.addMeasure(); // depth 2：静默
        expect(onChange).not.toHaveBeenCalled();

        scoreStore.endBatch(); // depth 1：仍静默
        expect(scoreStore._batchDepth).toBe(1);
        expect(onChange).not.toHaveBeenCalled();

        scoreStore.endBatch(); // depth 0：通知一次
        expect(scoreStore._batchDepth).toBe(0);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('endBatch 不会把深度压到负数', () => {
        scoreStore.endBatch();
        expect(scoreStore._batchDepth).toBe(0);

        scoreStore.endBatch();
        expect(scoreStore._batchDepth).toBe(0);
    });
});

describe('回调注入', () => {
    it('setOnChange 注入后动作能触发数据变更回调', () => {
        const onChange = vi.fn();
        scoreStore.setOnChange(onChange);

        scoreStore.addMeasure();

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('setOnSelectChange 注入后选中变化能触发回调', () => {
        scoreStore.score.measures = [measure([])];
        const onSelect = vi.fn();
        scoreStore.setOnSelectChange(onSelect);

        scoreStore.selectMeasure(0);

        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});
