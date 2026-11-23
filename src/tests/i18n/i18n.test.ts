/**
 * i18n 综合测试（全部 i18n 用例集中在本文件）
 *
 * 1. core/i18n 运行时：locale 状态 / t 回退 / 语言检测；
 * 2. 字典完整性：zh/en 同 key、无空值、英文无中文、占位符一致；
 * 3. index.html 静态钩子：key 存在、叶子约束、无漏翻；
 * 4. applyLocale 只跑幂等刷新（AST 静态检查）；
 * 5. 源码中文字面量残留审计（AST）。
 *
 * 默认 zh-CN 是既有中文断言全绿的前提；切换语言的用例必须在 afterEach 恢复。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import * as ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import {
    detectLocaleFromLanguage,
    getLocale,
    hasMessage,
    isLocale,
    setLocale,
    t,
} from '../../core/i18n/index.ts';
import type { MessageValue } from '../../core/i18n/index.ts';
import { EN, ZH_CN } from '../../core/i18n/messages.ts';

afterEach(() => setLocale('zh-CN'));

// ============================================================
// 1. 运行时
// ============================================================

describe('locale 状态', () => {
    it('默认 zh-CN', () => {
        expect(getLocale()).toBe('zh-CN');
    });

    it('setLocale 切换后可取回', () => {
        setLocale('en');
        expect(getLocale()).toBe('en');
    });

    it('isLocale 只接受 zh-CN / en', () => {
        expect(isLocale('zh-CN')).toBe(true);
        expect(isLocale('en')).toBe(true);
        expect(isLocale('zh')).toBe(false);
        expect(isLocale('EN')).toBe(false);
        expect(isLocale(null)).toBe(false);
        expect(isLocale(1)).toBe(false);
    });
});

describe('t', () => {
    it('默认返回中文', () => {
        expect(t('status.readyShort')).toBe('就绪');
    });

    it('切到 en 返回英文', () => {
        setLocale('en');
        expect(t('status.readyShort')).toBe('Ready');
    });

    it('未知 key 原样返回（运行期兜底）', () => {
        expect(t('no.such.key' as never)).toBe('no.such.key');
    });

    it('hasMessage 区分已登记与未登记 key', () => {
        expect(hasMessage('status.ready')).toBe(true);
        expect(hasMessage('no.such.key')).toBe(false);
    });
});

describe('detectLocaleFromLanguage', () => {
    it('zh / zh-* 归到 zh-CN（大小写不敏感）', () => {
        expect(detectLocaleFromLanguage('zh-CN')).toBe('zh-CN');
        expect(detectLocaleFromLanguage('zh-TW')).toBe('zh-CN');
        expect(detectLocaleFromLanguage('zh')).toBe('zh-CN');
        expect(detectLocaleFromLanguage('ZH-cn')).toBe('zh-CN');
    });

    it('其它语言归到 en', () => {
        expect(detectLocaleFromLanguage('en-US')).toBe('en');
        expect(detectLocaleFromLanguage('fr')).toBe('en');
        expect(detectLocaleFromLanguage('ja-JP')).toBe('en');
    });

    it('空值回落 zh-CN', () => {
        expect(detectLocaleFromLanguage(null)).toBe('zh-CN');
        expect(detectLocaleFromLanguage(undefined)).toBe('zh-CN');
        expect(detectLocaleFromLanguage('   ')).toBe('zh-CN');
    });
});

// ============================================================
// 2. 字典完整性
// ============================================================

/** 英文里允许保留中文的关键词示例（本地描述解析只认中文） */
const ALLOW_CJK_IN_EN = new Set([
    'improv.localPlaceholder',
    'improv.localHelp',
    'ai.placeholder',
    'ai.help',
]);

/** CJK 标点 / 扩展 A / 基本区 / 兼容区 / 全角块；`u` 防止 emoji 代理对被误判 */
const CJK_DICT = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u;

function branches(value: MessageValue): string[] {
    return typeof value === 'string' ? [value] : [value.one, value.other];
}

function placeholders(value: MessageValue): string[] {
    const names = new Set<string>();
    for (const branch of branches(value)) {
        for (const match of branch.matchAll(/\{(\w+)\}/g)) names.add(match[1]);
    }
    return [...names].sort();
}

describe('字典', () => {
    const zhKeys = Object.keys(ZH_CN).sort();
    const enKeys = Object.keys(EN).sort();

    it('zh / en key 集合一致', () => {
        expect(enKeys).toEqual(zhKeys);
    });

    it('没有空值', () => {
        for (const [key, value] of Object.entries(ZH_CN)) {
            for (const branch of branches(value)) expect(branch, `zh:${key}`).not.toBe('');
        }
        for (const [key, value] of Object.entries(EN)) {
            for (const branch of branches(value)) expect(branch, `en:${key}`).not.toBe('');
        }
    });

    it('英文值不含中文 / 全角标点（输入示例 key 例外）', () => {
        for (const [key, value] of Object.entries(EN)) {
            if (ALLOW_CJK_IN_EN.has(key)) continue;
            for (const branch of branches(value)) {
                expect(CJK_DICT.test(branch), `en:${key} 含中文：${branch}`).toBe(false);
            }
        }
    });

    it('同 key 的占位符集合一致', () => {
        for (const key of zhKeys) {
            const zh = placeholders(ZH_CN[key as keyof typeof ZH_CN]);
            const en = placeholders(EN[key as keyof typeof EN]);
            expect(en, `占位符不一致：${key}`).toEqual(zh);
        }
    });
});

// ============================================================
// 3. index.html 静态钩子
// ============================================================

const html = readFileSync('index.html', 'utf8');

const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const CJK_HTML = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u;

interface OpenTag {
    name: string;
    hasI18n: boolean;
}

/** 去掉注释后做最简单的标签 / 文本扫描，足够覆盖本项目的静态 HTML */
function scan(source: string): {
    keys: string[];
    textLeaks: string[];
    attrLeaks: string[];
    leafViolations: string[];
} {
    const cleaned = source.replace(/<!--[\s\S]*?-->/g, '');
    const tokenRe = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<\/([a-zA-Z][\w-]*)\s*>|([^<]+)/g;
    const stack: OpenTag[] = [];
    const keys: string[] = [];
    const textLeaks: string[] = [];
    const attrLeaks: string[] = [];
    const leafViolations: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = tokenRe.exec(cleaned))) {
        const [, openName, attrs, closeName, text] = match;

        if (openName) {
            const hasI18n = /\sdata-i18n="/.test(attrs);
            for (const keyMatch of attrs.matchAll(/data-i18n(?:-title|-placeholder|-aria-label|-content|-label)?="([^"]+)"/g)) {
                keys.push(keyMatch[1]);
            }
            // 带 data-i18n 的元素内部不应再有元素（叶子约束）
            if (hasI18n && stack.some(tag => tag.hasI18n)) {
                leafViolations.push(`<${openName}> 位于 data-i18n 元素内部`);
            }
            const attrHooks: Array<[string, string]> = [
                ['title', 'data-i18n-title'],
                ['placeholder', 'data-i18n-placeholder'],
                ['aria-label', 'data-i18n-aria-label'],
            ];
            for (const [attr, hook] of attrHooks) {
                const value = new RegExp(`\\s${attr}="([^"]*)"`).exec(attrs)?.[1];
                if (value && CJK_HTML.test(value) && !attrs.includes(hook)) {
                    attrLeaks.push(`<${openName} ${attr}="${value}">`);
                }
            }
            if (!VOID_TAGS.has(openName.toLowerCase()) && !attrs.trim().endsWith('/')) {
                stack.push({ name: openName, hasI18n });
            }
            continue;
        }

        if (closeName) {
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].name === closeName) {
                    stack.length = i;
                    break;
                }
            }
            continue;
        }

        if (text) {
            const trimmed = text.trim();
            if (trimmed === '' || !CJK_HTML.test(trimmed)) continue;
            const owner = stack[stack.length - 1];
            // 语言下拉的「中文」是语言自称，允许保留
            if (owner?.hasI18n || trimmed === '中文') continue;
            textLeaks.push(trimmed.slice(0, 40));
        }
    }

    return { keys, textLeaks, attrLeaks, leafViolations };
}

describe('index.html i18n 钩子', () => {
    const { keys, textLeaks, attrLeaks, leafViolations } = scan(html);

    it('所有钩子 key 都能在字典中找到', () => {
        const missing = [...new Set(keys)].filter(key => !hasMessage(key));
        expect(missing).toEqual([]);
    });

    it('data-i18n 只挂在叶子元素上', () => {
        expect(leafViolations).toEqual([]);
    });

    it('没有漏翻的中文文本节点', () => {
        expect(textLeaks).toEqual([]);
    });

    it('没有漏翻的中文 title / placeholder / aria-label', () => {
        expect(attrLeaks).toEqual([]);
    });

    it('语言下拉恰为 zh-CN / en，并使用语言自称', () => {
        const select = /<select[^>]*id="uiLanguageSelect"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? '';
        const options = [...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)]
            .map(match => [match[1], match[2].trim()]);
        expect(options).toEqual([['zh-CN', '中文'], ['en', 'English']]);
    });
});

// ============================================================
// 4. applyLocale 调用约束（AST）
// ============================================================

/** 禁止从 applyLocale 调用的初始化函数（见 CLAUDE.md / 实施计划 1.4） */
const FORBIDDEN_CALLS = new Set([
    'initEventListeners',
    'initRenderer',
    'initDisplayModeControl',
    'initSearchSelects',
    'initNoteInput',
    'initMeasureControls',
    'initScoreControls',
    'initPlaybackControls',
    'initAIForm',
    'initLocalImprovForm',
    'initImprovModeSwitch',
    'initChordGrid',
    'syncScoreDefaultsToUI',
    'initLanguageControl',
]);

const applyLocaleSource = ts.createSourceFile(
    'src/app/i18n.ts',
    readFileSync('src/app/i18n.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
);

function findApplyLocale(): ts.FunctionDeclaration | null {
    let found: ts.FunctionDeclaration | null = null;
    const visit = (node: ts.Node): void => {
        if (found) return;
        if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyLocale') {
            found = node;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(applyLocaleSource);
    return found;
}

describe('applyLocale 约束', () => {
    const fn = findApplyLocale();

    it('函数存在', () => {
        expect(fn).not.toBeNull();
    });

    it('不调用任何初始化函数', () => {
        const called = new Set<string>();
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
                called.add(node.expression.text);
            }
            ts.forEachChild(node, visit);
        };
        if (fn?.body) visit(fn.body);

        const violations = [...called].filter(name => FORBIDDEN_CALLS.has(name));
        expect(violations).toEqual([]);
    });

    it('带 applying 重入守卫', () => {
        let guarded = false;
        const visit = (node: ts.Node): void => {
            // 守卫写成 `if (applying || !isLocale(locale)) return;`，条件不是单个标识符
            if (ts.isIfStatement(node) && /\bapplying\b/.test(node.expression.getText())) {
                guarded = true;
            }
            ts.forEachChild(node, visit);
        };
        if (fn?.body) visit(fn.body);
        expect(guarded).toBe(true);
    });
});

// ============================================================
// 5. 源码中文字面量残留审计（AST）
// ============================================================

/**
 * 扫描 app / features / core(stores|utils) 的字符串字面量，英文模式下会
 * 直接显示给用户的中文必须走 `t()`。以下情况不算残留：
 * - 注释（AST 里根本不是字符串）；
 * - `console.*` 的开发者日志；
 * - 对象属性名（机器值，如密度的 `'低' | '中' | '高'`，只翻 label）；
 * - 模板里的 HTML 注释（被注释掉的按钮）。
 *
 * 固定中文的提示词资产（AI prompt、关键词正则、可调配置）在白名单里。
 */

// 用显式码点区间 + `u` 标记：否则 U+1D183（𝆃）的高位代理会被当成 CJK 兼容区命中
const CJK_SOURCE = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u;

const SOURCE_ROOTS = ['src/app', 'src/features', 'src/core/stores', 'src/core/utils'];

/** 按约定固定中文：AI 提示词 / 契约说明 / 触发词 / 关键词解析 / 可调配置 */
const SOURCE_WHITELIST = new Set([
    'src/features/ai/promptBuilder.ts',
    'src/features/ai/noteContract.ts',
    'src/features/ai/improvBriefPrompt.ts',
    'src/features/ai/improvPatchPrompt.ts',
    'src/features/ai/improvService.ts',
    'src/features/ai/promptTriggers.ts',
    'src/core/config.ts',
    'src/core/utils/improv/description.ts',
]);

function listTsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const file = join(dir, entry).split(sep).join('/');
        if (statSync(file).isDirectory()) listTsFiles(file, out);
        else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) out.push(file);
    }
    return out;
}

/** 字符串是否位于 `console.*(...)` 的实参里（开发者日志不翻译） */
function isConsoleArg(node: ts.Node): boolean {
    let current: ts.Node = node;
    while (current.parent) {
        const parent: ts.Node = current.parent;
        if (ts.isCallExpression(parent)) {
            const callee = parent.expression;
            return ts.isPropertyAccessExpression(callee)
                && ts.isIdentifier(callee.expression)
                && callee.expression.text === 'console';
        }
        current = parent;
    }
    return false;
}

/** 字符串是否是对象字面量的键（机器值，如密度 `'低'` 的 value 必须保持中文） */
function isPropertyName(node: ts.Node): boolean {
    return ts.isPropertyAssignment(node.parent) && node.parent.name === node;
}

function findCjkResidue(file: string, source: string): string[] {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);
    const hits: string[] = [];
    const visit = (node: ts.Node): void => {
        let text: string | null = null;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
            || ts.isTemplateHead(node) || ts.isTemplateMiddle(node)
            || ts.isTemplateTail(node)) {
            text = node.text;
        }
        if (text !== null && !isConsoleArg(node) && !isPropertyName(node)) {
            const cleaned = text.replace(/<!--[\s\S]*?-->/g, '');
            if (CJK_SOURCE.test(cleaned)) {
                const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
                hits.push(`${file}:${line + 1}: ${JSON.stringify(cleaned.slice(0, 80))}`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return hits;
}

describe('源码中文字面量审计', () => {
    it('能识别普通中文，同时忽略 console / 属性名 / HTML 注释', () => {
        const source = [
            "const shown = '中文文案';",
            "console.warn('调试日志');",
            "const map = { '低': 1 };",
            'const html = `<!-- 注释掉的中文 -->`;',
        ].join('\n');
        const hits = findCjkResidue('canary.ts', source);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toContain('中文文案');
    });

    it('界面层没有遗漏的中文字面量', () => {
        const files = SOURCE_ROOTS.flatMap(root => listTsFiles(root))
            .filter(file => !SOURCE_WHITELIST.has(file));
        expect(files.length).toBeGreaterThan(80);
        const hits = files.flatMap(file => findCjkResidue(file, readFileSync(file, 'utf8')));
        expect(hits).toEqual([]);
    });
});
