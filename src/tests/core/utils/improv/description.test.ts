/**
 * description — 自由描述到生成选项的关键词映射测试。
 */

import { describe, it, expect } from 'vitest';
import {
    detectUnsupportedDescription,
    parseDescriptionChordChart,
    parseDescriptionFretRange,
    parseImprovDescription,
} from '../../../../core/utils/improv/description.ts';

describe('parseImprovDescription', () => {
    it('空描述不产生任何覆盖', () => {
        expect(parseImprovDescription('')).toEqual({});
        expect(parseImprovDescription('   \n  ')).toEqual({});
    });

    it('识别风格关键词，并取文本中最先出现的那个', () => {
        expect(parseImprovDescription('来一段爵士')).toEqual({ style: 'Jazz' });
        expect(parseImprovDescription('蓝调一点')).toEqual({ style: 'Blues' });
        expect(parseImprovDescription('先爵士再摇滚')).toEqual({ style: 'Jazz' });
        expect(parseImprovDescription('摇滚然后爵士')).toEqual({ style: 'Rock' });
        expect(parseImprovDescription('classical guitar')).toEqual({ style: 'Classical' });
    });

    it('识别密度关键词', () => {
        expect(parseImprovDescription('高密度')).toEqual({ density: '高' });
        expect(parseImprovDescription('音符少一点，稀疏些')).toEqual({ density: '低' });
        expect(parseImprovDescription('中等密度')).toEqual({ density: '中' });
        expect(parseImprovDescription('high density')).toEqual({ density: '高' });
        expect(parseImprovDescription('sparse')).toEqual({ density: '低' });
    });

    it('识别小节数与拍号，并夹到本地配置范围内', () => {
        expect(parseImprovDescription('16 小节')).toEqual({ numMeasures: 16 });
        expect(parseImprovDescription('8小节 7/8')).toEqual({
            numMeasures: 8,
            timeSignature: '7/8',
        });
        expect(parseImprovDescription('12 bars in 6/8')).toEqual({
            numMeasures: 12,
            timeSignature: '6/8',
        });
        expect(parseImprovDescription('99 小节')).toEqual({ numMeasures: 16 });
        expect(parseImprovDescription('1 小节')).toEqual({ numMeasures: 2 });
    });

    it('不认识的拍号不覆盖', () => {
        expect(parseImprovDescription('8/8')).toEqual({});
        expect(parseImprovDescription('4/4')).toEqual({ timeSignature: '4/4' });
    });

    it('大小调调性同时推导默认音阶', () => {
        expect(parseImprovDescription('D 大调')).toEqual({
            key: 'D',
            scaleType: 'Major (Ionian)',
        });
        expect(parseImprovDescription('a小调')).toEqual({
            key: 'Am',
            scaleType: 'Natural Minor (Aeolian)',
        });
        expect(parseImprovDescription('F# minor')).toEqual({
            key: 'F#m',
            scaleType: 'Natural Minor (Aeolian)',
        });
        expect(parseImprovDescription('Bb大调')).toEqual({
            key: 'Bb',
            scaleType: 'Major (Ionian)',
        });
        expect(parseImprovDescription('Am')).toEqual({
            key: 'Am',
            scaleType: 'Natural Minor (Aeolian)',
        });
    });

    it('显式音阶覆盖调性推导出的默认音阶', () => {
        expect(parseImprovDescription('A 小调 布鲁斯音阶')).toEqual({
            key: 'Am',
            scaleType: 'Blues',
            style: 'Blues',
        });
        expect(parseImprovDescription('D major, blues scale')).toEqual({
            key: 'D',
            scaleType: 'Blues',
            style: 'Blues',
        });
    });

    it('识别常见音阶关键词', () => {
        expect(parseImprovDescription('小调五声')).toEqual({
            scaleType: 'Pentatonic Minor',
        });
        expect(parseImprovDescription('自然小调')).toEqual({
            scaleType: 'Natural Minor (Aeolian)',
        });
        expect(parseImprovDescription('和声小调')).toEqual({
            scaleType: 'Harmonic Minor',
        });
        expect(parseImprovDescription('dorian')).toEqual({
            scaleType: 'Dorian',
        });
    });

    it('组合描述一次覆盖多个字段', () => {
        expect(parseImprovDescription('爵士 16 小节 高密度 7/8 D大调')).toEqual({
            style: 'Jazz',
            numMeasures: 16,
            density: '高',
            timeSignature: '7/8',
            key: 'D',
            scaleType: 'Major (Ionian)',
        });
    });

    it('纯英文组合也能解析', () => {
        expect(parseImprovDescription('jazz 12 bars, high density, 6/8, in D major')).toEqual({
            style: 'Jazz',
            numMeasures: 12,
            density: '高',
            timeSignature: '6/8',
            key: 'D',
            scaleType: 'Major (Ionian)',
        });
    });

    it('无关文字不会误命中', () => {
        expect(parseImprovDescription('随便弹点好听的')).toEqual({});
        expect(parseImprovDescription('AI 即兴')).toEqual({});
        expect(parseImprovDescription('I am ready')).toEqual({});
    });

    it('识别把位范围', () => {
        expect(parseImprovDescription('7-10品')).toEqual({
            fretRange: { min: 7, max: 10 },
        });
        expect(parseImprovDescription('把位固定在 8 到 13 品')).toEqual({
            fretRange: { min: 8, max: 13 },
        });
        expect(parseImprovDescription('在 8–13 品内即兴')).toEqual({
            fretRange: { min: 8, max: 13 },
        });
    });

    it('识别小节写法的和弦进行，且不把进行里的 Am 误当调性', () => {
        expect(parseImprovDescription('在 | C G | Am F | 内即兴')).toEqual({
            progression: [
                { rootPitchClass: 0, quality: 'major' },
                { rootPitchClass: 7, quality: 'major' },
                { rootPitchClass: 9, quality: 'minor' },
                { rootPitchClass: 5, quality: 'major' },
            ],
        });
    });

    it('识别带标签的进行，且不把进行内容当成调性', () => {
        expect(parseImprovDescription('和弦进行：C G Am F')).toEqual({
            progression: [
                { rootPitchClass: 0, quality: 'major' },
                { rootPitchClass: 7, quality: 'major' },
                { rootPitchClass: 9, quality: 'minor' },
                { rootPitchClass: 5, quality: 'major' },
            ],
        });
    });

    it('指型与自然音限制进入不支持的提示', () => {
        expect(detectUnsupportedDescription('把位固定在 7-10 品')).toEqual([]);
        expect(detectUnsupportedDescription('在 La 指型（D 型）内')).toEqual([
            '指型图案（La/D 型等）暂未支持，当前按音阶自由度生成',
        ]);
        expect(detectUnsupportedDescription('不要 A#，尽量落在 A-G 这些音上')).toContain(
            '自然音/升降音限制暂未支持，生成仍按音阶与和弦音池',
        );
    });

    it('不支持提示不会误伤自然音阶与和弦范围写法', () => {
        expect(detectUnsupportedDescription('用自然音阶')).toEqual([]);
        expect(detectUnsupportedDescription('和弦落在 C-G-Am-F 上')).toEqual([]);
    });

    it('标签进行只消费和弦 token，行尾的调性与把位仍然生效', () => {
        expect(parseImprovDescription('和弦进行：C G Am F、D 大调、7-10品')).toEqual({
            progression: [
                { rootPitchClass: 0, quality: 'major' },
                { rootPitchClass: 7, quality: 'major' },
                { rootPitchClass: 9, quality: 'minor' },
                { rootPitchClass: 5, quality: 'major' },
            ],
            key: 'D',
            scaleType: 'Major (Ionian)',
            fretRange: { min: 7, max: 10 },
        });
        expect(parseImprovDescription('和弦进行：2-5-1，7-10品')).toEqual({
            progression: [2, 5, 1],
            fretRange: { min: 7, max: 10 },
        });
    });

    it('标签可以省略冒号', () => {
        expect(parseImprovDescription('和弦进行 C G Am F')).toEqual({
            progression: [
                { rootPitchClass: 0, quality: 'major' },
                { rootPitchClass: 7, quality: 'major' },
                { rootPitchClass: 9, quality: 'minor' },
                { rootPitchClass: 5, quality: 'major' },
            ],
        });
    });

    it('无标点时也不会把行尾把位/调性吞进进行', () => {
        const cGAmF = [
            { rootPitchClass: 0, quality: 'major' },
            { rootPitchClass: 7, quality: 'major' },
            { rootPitchClass: 9, quality: 'minor' },
            { rootPitchClass: 5, quality: 'major' },
        ];
        expect(parseImprovDescription('和弦进行：C G Am F 7-10品')).toEqual({
            progression: cGAmF,
            fretRange: { min: 7, max: 10 },
        });
        expect(parseImprovDescription('和弦进行：C G Am F D 大调')).toEqual({
            progression: cGAmF,
            key: 'D',
            scaleType: 'Major (Ionian)',
        });
    });

    it('七和弦后缀不会被当成调性短语截断', () => {
        expect(parseImprovDescription('和弦进行：Cmaj7 G7')).toEqual({
            progression: [
                { rootPitchClass: 0, quality: 'major7' },
                { rootPitchClass: 7, quality: 'dominant7' },
            ],
        });
    });
});

describe('parseDescriptionChordChart', () => {
    it('从散文里截取含小节线的一行', () => {
        expect(parseDescriptionChordChart('先来 | C G | Am F | 收尾')).toEqual([
            [
                { rootPitchClass: 0, quality: 'major' },
                { rootPitchClass: 7, quality: 'major' },
            ],
            [
                { rootPitchClass: 9, quality: 'minor' },
                { rootPitchClass: 5, quality: 'major' },
            ],
        ]);
    });

    it('支持跨行、单边小节线与行内夹散文的小节写法', () => {
        const expected = [
            [
                { rootPitchClass: 0, quality: 'major' },
                { rootPitchClass: 7, quality: 'major' },
            ],
            [
                { rootPitchClass: 9, quality: 'minor' },
                { rootPitchClass: 5, quality: 'major' },
            ],
        ];
        expect(parseDescriptionChordChart('| C G |\n| Am F |')).toEqual(expected);
        expect(parseDescriptionChordChart('| C G | 然后 | Am F |')).toEqual(expected);
        expect(parseDescriptionChordChart('| C G | then | Am F |')).toEqual(expected);
        expect(parseDescriptionChordChart('C G | Am F')).toEqual(expected);
        expect(parseDescriptionChordChart('| C G | Am F')).toEqual(expected);
        expect(parseDescriptionChordChart('| C G |\nAm F |')).toEqual(expected);
    });

    it('没有小节线或小节内容非法时返回 null', () => {
        expect(parseDescriptionChordChart('C G Am F')).toBeNull();
        expect(parseDescriptionChordChart('| C | H |')).toBeNull();
        expect(parseDescriptionChordChart('| C | H')).toBeNull();
    });
});

describe('parseDescriptionFretRange', () => {
    it('支持连字符、en dash、中文「到/至」', () => {
        expect(parseDescriptionFretRange('7-10品')).toEqual({ min: 7, max: 10 });
        expect(parseDescriptionFretRange('8–13 品')).toEqual({ min: 8, max: 13 });
        expect(parseDescriptionFretRange('10 至 7 品')).toEqual({ min: 7, max: 10 });
        expect(parseDescriptionFretRange('没有范围限制')).toBeNull();
    });

    it('单个品位数字不构成锁定范围', () => {
        expect(parseDescriptionFretRange('4 弦 10 品')).toBeNull();
    });
});
