/**
 * description — 自由描述到生成选项的关键词映射测试。
 */

import { describe, it, expect } from 'vitest';
import { parseImprovDescription } from '../../../../core/utils/improv/description.ts';

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
});
