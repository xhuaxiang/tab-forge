/**
 * promptBuilder 测试 —— 系统提示词的拆分与拼装
 *
 * 覆盖两点：
 *   ① composeSystemPrompt 恒定追加数据结构，用户改不到契约
 *   ② stripContract 能把旧版「专业性描述 + 契约」整段剥成专业性描述，不产生重复契约
 */
import { describe, it, expect } from 'vitest';
import {
    composeSystemPrompt, stripContract, DEFAULT_EXPERT_PROMPT, buildUserPrompt,
} from '../../../features/ai/promptBuilder.ts';
import { NOTE_CONTRACT } from '../../../features/ai/noteContract.ts';
import { IMPROV_CONFIG } from '../../../core/config.ts';
import type { GenerationOptions } from '../../../features/ai/promptBuilder.ts';

const baseOptions: GenerationOptions = {
    numMeasures: 4,
    scaleType: IMPROV_CONFIG.scaleTypes[0].value,
    style: IMPROV_CONFIG.styles[0].value,
    density: IMPROV_CONFIG.densities[1].value,
};

describe('composeSystemPrompt', () => {
    it('默认拼装 = 专业性描述 + 数据结构', () => {
        expect(composeSystemPrompt()).toBe(`${DEFAULT_EXPERT_PROMPT}\n\n${NOTE_CONTRACT}`);
    });

    it('传自定义专业性描述时，数据结构仍然被追加', () => {
        const composed = composeSystemPrompt('只弹五声音阶。');
        expect(composed).toBe(`只弹五声音阶。\n\n${NOTE_CONTRACT}`);
        expect(composed).toContain('## 音符对象格式');
    });

    it('传空/纯空白时回退到默认专业性描述', () => {
        expect(composeSystemPrompt('')).toBe(composeSystemPrompt());
        expect(composeSystemPrompt('   \n  ')).toBe(composeSystemPrompt());
    });
});

describe('stripContract', () => {
    it('旧版整段（人格 + 契约 + 演奏要求）剥成专业性描述', () => {
        const persona = '你是一位精通吉他即兴演奏的 AI 音乐助手。';
        const expertTail = DEFAULT_EXPERT_PROMPT.slice(DEFAULT_EXPERT_PROMPT.indexOf('## 节奏多样性'));
        const legacySaved = `${persona}\n\n${NOTE_CONTRACT}\n\n${expertTail}`;

        const stripped = stripContract(legacySaved);
        expect(stripped).toBe(`${persona}\n\n${expertTail}`);
        expect(stripped).not.toContain('## 音符对象格式');
    });

    it('剥离后重新拼装不会出现两份数据结构', () => {
        const legacySaved = `${DEFAULT_EXPERT_PROMPT}\n\n${NOTE_CONTRACT}`;
        const composed = composeSystemPrompt(stripContract(legacySaved));
        expect(composed.match(/## 音符对象格式/g)).toHaveLength(1);
    });

    it('不含数据结构的文本原样返回', () => {
        expect(stripContract(DEFAULT_EXPERT_PROMPT)).toBe(DEFAULT_EXPERT_PROMPT);
    });
});

describe('buildUserPrompt — 风格/密度注入', () => {
    it('每一种风格都被真实注入（防止 hint 写了没人用）', () => {
        for (const s of IMPROV_CONFIG.styles) {
            const prompt = buildUserPrompt({ ...baseOptions, style: s.value });
            expect(s.hint, `${s.value} 的 hint 不能为空`).toBeTruthy();
            expect(prompt).toContain(s.hint as string);
            expect(prompt).toContain(`（${s.value}）`);
        }
    });

    it('每一档密度都被真实注入', () => {
        for (const d of IMPROV_CONFIG.densities) {
            const prompt = buildUserPrompt({ ...baseOptions, density: d.value });
            expect(prompt).toContain(d.hint as string);
        }
    });

    it('不同风格的提示词互不相同（换风格必须换文案）', () => {
        const prompts = IMPROV_CONFIG.styles.map(s => buildUserPrompt({ ...baseOptions, style: s.value }));
        expect(new Set(prompts).size).toBe(IMPROV_CONFIG.styles.length);
    });

    it('任务参数被注入：小节数 / 音阶 / 风格 / 密度', () => {
        const prompt = buildUserPrompt({ ...baseOptions, numMeasures: 8, scaleType: 'Blues' });
        expect(prompt).toContain('- 小节数：8');
        expect(prompt).toContain('- 音阶类型：Blues');
        expect(prompt).toContain('- 风格：');
        expect(prompt).toContain('- 密度：');
    });

    it('未知风格/密度不报错，退化为原值且不产生空标题', () => {
        const prompt = buildUserPrompt({ ...baseOptions, style: 'NoSuchStyle', density: 'NoSuchDensity' });
        expect(prompt).toContain('（NoSuchStyle）');
        expect(prompt).not.toContain('## 风格要求（NoSuchStyle）\n\n');
        expect(prompt).not.toContain('undefined');
    });

    it('额外要求位于末尾，且保留「冲突以本段为准」的优先级语义', () => {
        const prompt = buildUserPrompt({ ...baseOptions, extraPrompt: '只用五声音阶' });
        const extraAt = prompt.indexOf('只用五声音阶');
        const styleAt = prompt.indexOf('## 风格要求');
        expect(extraAt).toBeGreaterThan(styleAt);
        expect(prompt).toContain('优先级最高');
        expect(prompt.indexOf('请直接输出 JSON')).toBeGreaterThan(extraAt);
    });

    it('无额外要求时不出现空的额外要求段', () => {
        const prompt = buildUserPrompt(baseOptions);
        expect(prompt).not.toContain('## 额外要求');
    });
});

describe('提示词与 AI 契约的一致性（护栏）', () => {
    /** 所有会进提示词的文本：默认底盘 + 全部风格/密度文案 */
    const allPromptText = [
        DEFAULT_EXPERT_PROMPT,
        ...IMPROV_CONFIG.styles.map(s => s.hint ?? ''),
        ...IMPROV_CONFIG.densities.map(d => d.hint ?? ''),
    ].join('\n');

    it('提示词里出现的技法词必须都在 AI 白名单内（写别的会被静默丢弃）', () => {
        // 白名单见 responseParser.ts 的 AI_TECHNIQUES —— 提示词只许提它允许的技法
        const allowed = new Set(['hammerOn', 'pullOff', 'slide', 'bend', 'vibrato']);
        const found = new Set(allPromptText.match(/hammerOn|pullOff|slide|bend|vibrato/g) ?? []);
        expect(found.size).toBeGreaterThan(0); // 至少提到过技法，别退化成空
        for (const t of found) expect(allowed.has(t), `提示词提到未开放的技法 ${t}`).toBe(true);
    });

    it('提示词不得引导 AI 用无效的力度取值或推弦幅度', () => {
        // 合法力度见 responseParser.ts 的 VALID_DYNAMICS；合法推弦幅度见 VALID_BEND_AMOUNTS
        const badDynamics = allPromptText.match(/"dynamics":\s*"(?!soft|accent)[^"]*"/g) ?? [];
        expect(badDynamics).toEqual([]);
        const badBend = allPromptText.match(/"bendAmount":\s*([\d.]+)/g) ?? [];
        for (const m of badBend) {
            const v = parseFloat(m.split(':')[1]);
            expect([0.25, 0.5, 1], `示例里的推弦幅度 ${v} 不合法`).toContain(v);
        }
    });

    it('技法与力度的说明必须同时出现在 system 与 user 侧', () => {
        // 实测：只写在 system 里的要求（和声）模型连续两轮都没执行
        const userPrompt = buildUserPrompt(baseOptions);
        expect(DEFAULT_EXPERT_PROMPT).toMatch(/bend/);
        expect(DEFAULT_EXPERT_PROMPT).toMatch(/vibrato/);
        expect(DEFAULT_EXPERT_PROMPT).toMatch(/dynamics/);
        expect(userPrompt).toMatch(/dynamics|力度/);
    });

    it('默认底盘保留 stripContract 依赖的节标题锚点', () => {
        expect(DEFAULT_EXPERT_PROMPT).toContain('## 节奏多样性');
    });

    it('默认底盘必须交代和声（否则模型永远只出单音）', () => {
        // 曾经的坑：底盘一个字没提 chordGroup，模型就永远不填，输出纯单音 = 单调
        expect(DEFAULT_EXPERT_PROMPT).toContain('chordGroup');
        expect(DEFAULT_EXPERT_PROMPT).toContain('arpeggio');
        expect(DEFAULT_EXPERT_PROMPT).toContain('strum');
        expect(DEFAULT_EXPERT_PROMPT).toContain('和声');
    });

    it('默认底盘写明「默认取向而非硬性规则」，并给出「只弹单音」的例子', () => {
        // 这条保证额外要求能压得住底盘（用户点名要的能力）
        expect(DEFAULT_EXPERT_PROMPT).toContain('默认取向');
        expect(DEFAULT_EXPERT_PROMPT).toContain('只弹单音');
        expect(DEFAULT_EXPERT_PROMPT).toContain('完全不要用 chordGroup');
    });

    it('user prompt 必须带织体要求（实测：和声只写在 system 里时，连续两轮输出 0 个和弦）', () => {
        const prompt = buildUserPrompt(baseOptions);
        expect(prompt).toContain('chordGroup');
        expect(prompt).toContain('和声');
        expect(prompt).toContain('每 2-3 小节至少 1 处');
    });

    it('机器契约带一个含和弦的完整示例（小模型靠示例比靠描述有效）', () => {
        expect(NOTE_CONTRACT).toContain('## 示例');
        expect(NOTE_CONTRACT).toContain('"chordGroup": 1');
        expect(NOTE_CONTRACT).toContain('"arpeggio": "up"');
    });

    it('额外要求段声明可推翻默认取向，且仍标「优先级最高」', () => {
        const prompt = buildUserPrompt({ ...baseOptions, extraPrompt: '只弹单音' });
        expect(prompt).toContain('优先级最高');
        expect(prompt).toContain('可整体推翻前面的默认取向');
    });

    it('容量口径与代码一致（4/4 = 1.0，不是 4.0）', () => {
        // 代码口径：measureUtils.canAddToMeasure 的 cap = 分子 ÷ 分母；
        // 4/4 小节里 4 个四分音符的 duration 之和 = 1.0。
        // 注意排除容量说明行本身，否则 1.0 / 0.75 会被误判成时值。
        const capacityLine = DEFAULT_EXPERT_PROMPT.split('\n').find(l => l.includes('该小节容量')) ?? '';
        expect(capacityLine).toContain('4/4 = 1.0');
        expect(capacityLine).not.toContain('4/4 = 4');
    });
});

