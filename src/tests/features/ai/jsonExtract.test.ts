/**
 * jsonExtract — 从模型文本里提取 JSON 对象。
 *
 * 坏输入必须返回 null 而不是抛错：两个解析器都靠它判定「整包失败」。
 */

import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '../../../features/ai/jsonExtract.ts';

describe('extractJsonObject', () => {
    it('裸 JSON 直接解析', () => {
        expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    });

    it('markdown 代码块与前后说明都能剥掉', () => {
        expect(extractJsonObject('好的：\n```json\n{"a":[1,2]}\n```\n以上。'))
            .toEqual({ a: [1, 2] });
        expect(extractJsonObject('```\n{"b":true}\n```')).toEqual({ b: true });
    });

    it('没有代码块时取第一个 { 到最后一个 }', () => {
        expect(extractJsonObject('说明 {"a":{"b":2}} 结尾'))
            .toEqual({ a: { b: 2 } });
    });

    it('坏 JSON / 没有对象 / 空串都返回 null', () => {
        expect(extractJsonObject('{"a":')).toBeNull();
        expect(extractJsonObject('没有 JSON')).toBeNull();
        expect(extractJsonObject('')).toBeNull();
        expect(extractJsonObject('{')).toBeNull();
        expect(extractJsonObject('}')).toBeNull();
    });
});
