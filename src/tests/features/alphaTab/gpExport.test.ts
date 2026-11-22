/**
 * gpExport 单元测试
 *
 * exportToGp 依赖 alphaTab 的 Gp7Exporter（纯序列化，无 DOM），
 * 验证：输出是合法 zip 流、能被 alphaTab 重新读回（round-trip）、
 * 标题/艺术家/调弦/音符/时值没有在导出链路上丢失。
 * gpExportFileName 是纯字符串处理，单独覆盖边界。
 */

import { describe, it, expect } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import type { Note, Measure, TabScore } from '../../../core/types/index.ts';
import { STANDARD_TUNING } from '../../../core/types/index.ts';
import { exportToGp, gpExportFileName } from '../../../features/alphaTab/gpExport.ts';

function note(partial: Partial<Note> & { duration: Note['duration'] }): Note {
    return { string: 1, fret: 0, ...partial };
}

function measure(notes: Note[], num = 4, den = 4, index = 0): Measure {
    return { index, notes, timeSignatureNumerator: num, timeSignatureDenominator: den };
}

function makeScore(measures: Measure[], overrides: Partial<TabScore> = {}): TabScore {
    return {
        title: 'tab',
        artist: 'me',
        tuning: { ...STANDARD_TUNING },
        bpm: 120,
        measures,
        timeSignature: '4/4',
        ...overrides,
    };
}

/** zip 魔数 "PK" */
function isZip(bytes: Uint8Array): boolean {
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

describe('exportToGp', () => {
    it('输出非空 zip 二进制流', () => {
        const bytes = exportToGp(makeScore([measure([note({ string: 1, fret: 5, duration: 0.25 })])]));
        expect(bytes.length).toBeGreaterThan(0);
        expect(isZip(bytes)).toBe(true);
    });

    it('导出结果可被 alphaTab 重新读取：标题 / 艺术家 / 小节数 / 轨道', () => {
        const bytes = exportToGp(makeScore(
            [measure([note({ string: 1, fret: 5, duration: 0.25 })])],
            { title: 'Probe Song', artist: 'Someone' },
        ));
        const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
        expect(back.title).toBe('Probe Song');
        expect(back.artist).toBe('Someone');
        expect(back.tracks.length).toBe(1);
        expect(back.masterBars.length).toBe(1);
    });

    it('音符与调弦往返一致（弦号按 alphaTab 1 弦在最后的规则映射）', () => {
        const bytes = exportToGp(makeScore([
            measure([note({ string: 1, fret: 7, duration: 0.25 })], 4, 4),
        ]));
        const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
        const staff = back.tracks[0].staves[0];
        // 标准调弦 E4 B3 G3 D3 A2 E2
        expect(staff.stringTuning.tunings).toEqual([64, 59, 55, 50, 45, 40]);
        const beat = staff.bars[0].voices[0].beats[0];
        // 应用 1 弦（高音 E）→ alphaTab 弦号 6
        expect(beat.notes[0].string).toBe(6);
        expect(beat.notes[0].fret).toBe(7);
        expect(beat.duration).toBe(alphaTab.model.Duration.Quarter);
    });

    it('BPM 与逐小节拍号往返一致', () => {
        const bytes = exportToGp(makeScore([
            measure([note({ string: 1, fret: 5, duration: 0.25 })], 3, 4, 0),
            measure([note({ string: 2, fret: 3, duration: 0.25 })], 3, 4, 1),
        ], { bpm: 96 }));
        const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
        expect(back.tempo).toBe(96);
        expect(back.masterBars.length).toBe(2);
        for (const mb of back.masterBars) {
            expect(mb.timeSignatureNumerator).toBe(3);
            expect(mb.timeSignatureDenominator).toBe(4);
        }
    });

    it('技法标记（闷音）往返保留', () => {
        const bytes = exportToGp(makeScore([
            measure([note({ string: 1, fret: 5, duration: 0.25, palmMute: true })]),
        ]));
        const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
        const beat = back.tracks[0].staves[0].bars[0].voices[0].beats[0];
        expect(beat.notes[0].isPalmMute).toBe(true);
    });

    it('空谱也能导出（不抛错，序列化成 1 个休止小节）', () => {
        const bytes = exportToGp(makeScore([]));
        expect(isZip(bytes)).toBe(true);
        const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
        expect(back.masterBars.length).toBe(1);
    });
});

describe('gpExportFileName', () => {
    it('标题 + 艺术家用 " - " 连接并加 .gp 后缀', () => {
        expect(gpExportFileName({ title: 'Song', artist: 'Band' })).toBe('Song - Band.gp');
    });

    it('缺少艺术家时只用标题', () => {
        expect(gpExportFileName({ title: 'Song', artist: '' })).toBe('Song.gp');
        expect(gpExportFileName({ title: 'Song', artist: undefined })).toBe('Song.gp');
        expect(gpExportFileName({ title: 'Song' })).toBe('Song.gp');
    });

    it('标题与艺术家都为空时回落到 tab-score.gp', () => {
        expect(gpExportFileName({ title: '', artist: '' })).toBe('tab-score.gp');
        expect(gpExportFileName({ title: '   ', artist: '' })).toBe('tab-score.gp');
    });

    it('scoreStore 的默认标题占位符 "--" 视同空标题', () => {
        expect(gpExportFileName({ title: '--', artist: '' })).toBe('tab-score.gp');
        expect(gpExportFileName({ title: '--', artist: 'Band' })).toBe('Band.gp');
    });

    it('超长标题截断到 80 字符主干', () => {
        const filename = gpExportFileName({ title: 'a'.repeat(300), artist: '' });
        expect(filename).toBe(`${'a'.repeat(80)}.gp`);
    });

    it('路径分隔符与 Windows 保留字符替换为 "-"', () => {
        expect(gpExportFileName({ title: 'a/b:c*d?e"f<g>h|i\\j', artist: '' }))
            .toBe('a-b-c-d-e-f-g-h-i-j.gp');
    });

    it('连续空白折叠为单个空格并去掉首尾空白', () => {
        expect(gpExportFileName({ title: '  My   Song  ', artist: ' B ' })).toBe('My Song - B.gp');
    });
});
