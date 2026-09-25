/**
 * tabExport 单元测试
 *
 * 覆盖 ASCII 六线谱与 JSON 导出的确定性行为：
 * 头部格式、弦名行顺序、拍位→列的对齐、品位补零、
 * 休止符/空小节占位、越界弦号，以及 JSON 往返。
 *
 * 列的定义：一个「拍位」（forEachSlot 分组）在每行弦位行里占 2 个字符
 * （品位补零后两位，或休止的 `--`），列与列之间以一个 `-` 相连。
 * 故 n 列时该行 `|...|` 内的长度为 3n-1。
 */

import { describe, it, expect } from 'vitest';
import type { Measure, Note, TabScore } from '../../../core/types/index.ts';
import { STANDARD_TUNING } from '../../../core/types/index.ts';
import { exportToAsciiTab, exportToJson } from '../../../core/utils/tabExport.ts';
import { forEachSlot } from '../../../core/utils/measureUtils.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

/** 休止符：无弦号无品位，导出时整列占位 */
function rest(duration: Note['duration'] = 0.25): Note {
    return { duration, isRest: true };
}

function measure(notes: Note[], num = 4, den = 4, index = 0): Measure {
    return { index, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

function score(measures: Measure[], partial: Partial<TabScore> = {}): TabScore {
    return {
        title: 'Test Song',
        artist: 'Test Artist',
        tuning: STANDARD_TUNING,
        bpm: 120,
        measures,
        timeSignature: '4/4',
        ...partial,
    };
}

/** ASCII 输出的全部行 */
function outLines(s: TabScore): string[] {
    return exportToAsciiTab(s).split('\n');
}

/** 六行弦位行（跳过 5 行头部，末尾空行不计） */
function stringLines(s: TabScore): string[] {
    return outLines(s).slice(5, 11);
}

/** 取 `e|...|` 中两竖线之间的内容 */
function bodyOf(line: string): string {
    return line.slice(line.indexOf('|') + 1, line.lastIndexOf('|'));
}

/** 按 2 字符一列切出行内容；调用前需保证结构合法（长度 3n-1） */
function colsOf(line: string): string[] {
    const body = bodyOf(line);
    const cols: string[] = [];
    for (let i = 0; i + 2 <= body.length; i += 3) cols.push(body.slice(i, i + 2));
    return cols;
}

/** 断言六行弦位行的列数均为 n，且行内长度符合 3n-1（列分隔符对齐） */
function expectColumnCount(s: TabScore, n: number): void {
    for (const line of stringLines(s)) {
        expect(bodyOf(line)).toHaveLength(3 * n - 1);
        expect(colsOf(line)).toHaveLength(n);
    }
}

describe('exportToAsciiTab 头部', () => {
    it('两条 60 个 = 的分隔线 + 标题/艺术家行 + BPM/Tuning 行', () => {
        const lines = outLines(score([]));
        expect(lines[0]).toBe('='.repeat(60));
        expect(lines[0]).toHaveLength(60);
        expect(lines[1]).toBe('  Test Song - Test Artist');
        expect(lines[2]).toBe('  BPM: 120  |  Tuning: E2 A2 D3 G3 B3 E4');
        expect(lines[3]).toBe('='.repeat(60));
        expect(lines[3]).toHaveLength(60);
        expect(lines[4]).toBe('');
    });

    it('title 为空 → 用 - 占位', () => {
        const lines = outLines(score([], { title: '', artist: 'Someone' }));
        expect(lines[1]).toBe('  - - Someone');
    });

    it('title 与 artist 都为空 → 只有占位 -，不出现多余的 "- "', () => {
        const lines = outLines(score([], { title: '', artist: '' }));
        // 模板仍保留一个尾随空格（"  " + "-" + " " + ""），但不得出现第二个 -
        expect(lines[1]).toBe('  - ');
        expect(lines[1].trimEnd()).toBe('  -');
        expect(lines[1].slice(3)).toBe(' ');
    });

    it('artist 为空 → 不出现 "- " 尾巴', () => {
        const lines = outLines(score([], { artist: '' }));
        expect(lines[1].trimEnd()).toBe('  Test Song');
        expect(lines[1]).not.toContain('-');
    });

    it('BPM/Tuning 行按 6→1 弦顺序（与弦名行顺序相反）', () => {
        const lines = outLines(
            score([], {
                bpm: 90,
                tuning: { string1: 'D4', string2: 'A3', string3: 'F#3', string4: 'D3', string5: 'A2', string6: 'D2' },
            }),
        );
        expect(lines[2]).toBe('  BPM: 90  |  Tuning: D2 A2 D3 F#3 A3 D4');
    });
});

describe('exportToAsciiTab 空乐谱', () => {
    it('measures 为空 → 头部 + [Empty]，无弦位行', () => {
        const lines = outLines(score([], { title: 'Blank', artist: 'Nobody' }));
        expect(lines).toEqual([
            '='.repeat(60),
            '  Blank - Nobody',
            '  BPM: 120  |  Tuning: E2 A2 D3 G3 B3 E4',
            '='.repeat(60),
            '',
            '[Empty]',
        ]);
        expect(exportToAsciiTab(score([]))).not.toContain('e|');
    });
});

describe('exportToAsciiTab 弦位行结构', () => {
    it('弦名顺序为 e| B| G| D| A| E|，1 弦在最上；单音只占自己那列', () => {
        const s = score([measure([note({ string: 1, fret: 3, duration: 0.25 })])]);
        const lines = outLines(s);
        expect(lines).toHaveLength(12);
        expect(lines.slice(5, 11)).toEqual([
            'e|03|',
            'B|--|',
            'G|--|',
            'D|--|',
            'A|--|',
            'E|--|',
        ]);
        expect(lines[11]).toBe('');
    });

    it('空小节（notes: []）仍产生一列 --', () => {
        const s = score([measure([])]);
        expect(stringLines(s)).toEqual([
            'e|--|',
            'B|--|',
            'G|--|',
            'D|--|',
            'A|--|',
            'E|--|',
        ]);
        expectColumnCount(s, 1);
    });

    it('品位补零：0 → 00、3 → 03、10 → 10、24 → 24（含 0/24 品边界）', () => {
        const s = score([
            measure([
                note({ string: 1, fret: 0, duration: 0.25 }),
                note({ string: 2, fret: 3, duration: 0.25 }),
                note({ string: 3, fret: 10, duration: 0.25 }),
                note({ string: 4, fret: 24, duration: 0.25 }),
            ]),
        ]);
        const lines = stringLines(s);
        expect(colsOf(lines[0])).toEqual(['00', '--', '--', '--']);
        expect(colsOf(lines[1])).toEqual(['--', '03', '--', '--']);
        expect(colsOf(lines[2])).toEqual(['--', '--', '10', '--']);
        expect(colsOf(lines[3])).toEqual(['--', '--', '--', '24']);
        expect(colsOf(lines[4])).toEqual(['--', '--', '--', '--']);
        expect(colsOf(lines[5])).toEqual(['--', '--', '--', '--']);
        expectColumnCount(s, 4);
    });

    it('休止符占一列 --，相邻实音不串列', () => {
        const s = score([measure([rest(), note({ string: 1, fret: 3, duration: 0.25 })])]);
        const lines = stringLines(s);
        expect(colsOf(lines[0])).toEqual(['--', '03']);
        expect(colsOf(lines[1])).toEqual(['--', '--']);
        expect(colsOf(lines[5])).toEqual(['--', '--']);
        expectColumnCount(s, 2);
    });

    it('整小节休止仍占一列', () => {
        const s = score([measure([rest(1)])]);
        expect(stringLines(s)).toEqual([
            'e|--|',
            'B|--|',
            'G|--|',
            'D|--|',
            'A|--|',
            'E|--|',
        ]);
    });

    it('越界/缺省弦号不落品位，整列 --', () => {
        const s = score([
            measure([
                note({ string: 7, fret: 5, duration: 0.25 }),
                note({ string: 0, fret: 5, duration: 0.25 }),
                note({ duration: 0.25, string: undefined, fret: undefined }),
            ]),
        ]);
        for (const line of stringLines(s)) {
            expect(colsOf(line)).toEqual(['--', '--', '--']);
        }
        expectColumnCount(s, 3);
    });

    it('满 4/4 小节（4 个四分音符）→ 4 列', () => {
        const s = score([
            measure([
                note({ string: 1, fret: 0, duration: 0.25 }),
                note({ string: 2, fret: 1, duration: 0.25 }),
                note({ string: 3, fret: 2, duration: 0.25 }),
                note({ string: 4, fret: 3, duration: 0.25 }),
            ]),
        ]);
        expectColumnCount(s, 4);
        expect(stringLines(s)[0]).toBe('e|00---------|');
    });
});

describe('exportToAsciiTab 同拍位和弦', () => {
    it('同 chordGroup 的各弦落在同一列，六行列数一致', () => {
        const s = score([
            measure([
                note({ string: 1, fret: 3, duration: 0.25, chordGroup: 1 }),
                note({ string: 2, fret: 0, duration: 0.25, chordGroup: 1 }),
                note({ string: 3, fret: 2, duration: 0.25, chordGroup: 1 }),
                note({ string: 5, fret: 5, duration: 0.25 }),
            ]),
        ]);
        const lines = stringLines(s);
        expect(colsOf(lines[0])).toEqual(['03', '--']);
        expect(colsOf(lines[1])).toEqual(['00', '--']);
        expect(colsOf(lines[2])).toEqual(['02', '--']);
        expect(colsOf(lines[3])).toEqual(['--', '--']);
        expect(colsOf(lines[4])).toEqual(['--', '05']);
        expect(colsOf(lines[5])).toEqual(['--', '--']);
        expect(lines[0]).toBe('e|03---|');
        expect(lines[4]).toBe('A|---05|');
        expectColumnCount(s, 2);
    });

    it('同弦在同拍位出现时后者覆盖前者', () => {
        const s = score([
            measure([
                note({ string: 2, fret: 3, duration: 0.25, chordGroup: 4 }),
                note({ string: 2, fret: 7, duration: 0.25, chordGroup: 4 }),
            ]),
        ]);
        expect(colsOf(stringLines(s)[1])).toEqual(['07']);
        expectColumnCount(s, 1);
    });

    it('同 chordGroup 但不相邻时各自成列（按相邻合并）', () => {
        const s = score([
            measure([
                note({ string: 1, fret: 1, duration: 0.25, chordGroup: 2 }),
                note({ string: 2, fret: 2, duration: 0.25 }),
                note({ string: 3, fret: 3, duration: 0.25, chordGroup: 2 }),
            ]),
        ]);
        expect(colsOf(stringLines(s)[0])).toEqual(['01', '--', '--']);
        expect(colsOf(stringLines(s)[1])).toEqual(['--', '02', '--']);
        expect(colsOf(stringLines(s)[2])).toEqual(['--', '--', '03']);
        expectColumnCount(s, 3);
    });
});

describe('exportToAsciiTab 跨多拍的列数', () => {
    it('列数 = 拍位数（一个拍位一列，与 duration 无关）', () => {
        const s = score([
            // 1 个拍位：全音符
            measure([note({ string: 6, fret: 0, duration: 1 })], 4, 4, 0),
            // 3 个拍位：二分 + 四分 + 四分（tieToNext 不改变分组）
            measure(
                [
                    note({ string: 1, fret: 12, duration: 0.5 }),
                    note({ string: 3, fret: 5, duration: 0.25 }),
                    note({ string: 3, fret: 5, duration: 0.25, tieToNext: true }),
                ],
                4,
                4,
                1,
            ),
        ]);
        const lines = stringLines(s);
        expect(colsOf(lines[0])).toEqual(['--', '12', '--', '--']);
        expect(colsOf(lines[1])).toEqual(['--', '--', '--', '--']);
        expect(colsOf(lines[2])).toEqual(['--', '--', '05', '05']);
        expect(colsOf(lines[5])).toEqual(['00', '--', '--', '--']);
        expectColumnCount(s, 4);
    });

    it('多小节混合时值：列数 = 各小节 forEachSlot 分组数之和', () => {
        const measures = [
            // 1 组
            measure([note({ string: 6, fret: 0, duration: 1 })], 4, 4, 0),
            // 3 组
            measure(
                [
                    note({ string: 1, fret: 12, duration: 0.5 }),
                    note({ string: 3, fret: 5, duration: 0.25 }),
                    note({ string: 3, fret: 5, duration: 0.25 }),
                ],
                4,
                4,
                1,
            ),
            // 2 组：二音和弦 + 休止
            measure(
                [
                    note({ string: 4, fret: 2, duration: 0.25, chordGroup: 9 }),
                    note({ string: 5, fret: 2, duration: 0.25, chordGroup: 9 }),
                    rest(),
                ],
                4,
                4,
                2,
            ),
        ];
        const s = score(measures);

        // 硬编码推导值（1 + 3 + 2），再用 forEachSlot 交叉验证分组规则本身未漂移
        let slotCount = 0;
        for (const m of measures) forEachSlot(m, () => slotCount++);
        expect(slotCount).toBe(6);

        const lines = stringLines(s);
        expect(colsOf(lines[0])).toEqual(['--', '12', '--', '--', '--', '--']);
        expect(colsOf(lines[3])).toEqual(['--', '--', '--', '--', '02', '--']);
        expect(colsOf(lines[4])).toEqual(['--', '--', '--', '--', '02', '--']);
        expect(colsOf(lines[5])).toEqual(['00', '--', '--', '--', '--', '--']);
        expectColumnCount(s, slotCount);
    });
});

describe('exportToJson', () => {
    it('缩进 2 空格的 JSON，parse 回来与原 TabScore 深相等', () => {
        const s = score(
            [
                measure([note({ string: 1, fret: 3, duration: 0.25 }), rest(0.5)], 3, 4, 0),
                measure([], 3, 4, 1),
            ],
            { key: 'G', remarks: '测试备注' },
        );
        const json = exportToJson(s);
        expect(json).toBe(JSON.stringify(s, null, 2));
        expect(json.startsWith('{\n  "title": "Test Song"')).toBe(true);
        expect(JSON.parse(json)).toEqual(s);
        expect(JSON.parse(json)).toStrictEqual(s);
    });

    it('空乐谱与可选字段缺省时同样往返无损', () => {
        const s = score([], { title: '', artist: '', bpm: 0 });
        const parsed = JSON.parse(exportToJson(s)) as TabScore;
        expect(parsed).toStrictEqual(s);
        expect(parsed.measures).toEqual([]);
        expect(parsed.key).toBeUndefined();
        expect(parsed.remarks).toBeUndefined();
    });
});
