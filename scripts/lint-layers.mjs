#!/usr/bin/env node
/**
 * lint:layers — 层级与副作用边界检查。
 *
 * 用 TypeScript AST 取代 CLAUDE.md 里那三条 grep，检查：
 *   1. src/core/ 不出现浏览器全局（document / window / self / AudioContext / chrome / fetch / storage 等）；
 *   2. src/core/ 不依赖 app/、features/、stores/ 或入口文件（stores 内部互导除外）；
 *   3. playback/karplus 与 playback/soundfont 的实现互不导入（含 playback/index.ts 聚合层，import type 放行）。
 *
 * 零新增依赖：直接使用项目已有的 typescript。
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'];
const errors = [];

function toPosix(value) {
    return value.split(path.sep).join('/');
}

function relative(file) {
    return toPosix(path.relative(root, file));
}

function isUnder(file, dir) {
    const rel = relative(file);
    return rel === dir || rel.startsWith(`${dir}/`);
}

/** 去掉源码扩展名，便于比较 `../index.ts` 与 `../index` 这类同一模块。 */
function modulePath(file) {
    const rel = relative(file);
    const ext = SOURCE_EXTENSIONS.find(candidate => rel.endsWith(candidate));
    return ext ? rel.slice(0, -ext.length) : rel;
}

function isSameModule(file, moduleName) {
    return modulePath(file) === moduleName;
}

function scriptKindFor(file) {
    if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
    if (file.endsWith('.js') || file.endsWith('.mjs')) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
}

async function collectSourceFiles(dir) {
    const files = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectSourceFiles(full));
        } else if (entry.isFile()
            && SOURCE_EXTENSIONS.some(ext => entry.name.endsWith(ext))
            && !entry.name.endsWith('.d.ts')) {
            files.push(full);
        }
    }
    return files;
}

function report(file, sourceFile, node, message) {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    errors.push(`${relative(file)}:${pos.line + 1} ${message}`);
}

function isTypeOnlyImport(node) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const { elements } = clause.namedBindings;
        return elements.length > 0 && elements.every(element => element.isTypeOnly);
    }
    return false;
}

function isTypeOnlyExport(node) {
    if (node.isTypeOnly) return true;
    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        const { elements } = node.exportClause;
        return elements.length > 0 && elements.every(element => element.isTypeOnly);
    }
    return false;
}

function checkModuleSpecifier(file, sourceFile, node, specifier, typeOnly) {
    if (!specifier.startsWith('.')) return;
    const target = path.resolve(path.dirname(file), specifier);

    if (isUnder(file, 'src/core')) {
        if (isUnder(target, 'src/app')) {
            report(file, sourceFile, node, `core 禁止依赖 app/（${specifier}）`);
        }
        if (isUnder(target, 'src/features')) {
            report(file, sourceFile, node, `core 禁止依赖 features/（${specifier}）`);
        }
        if (!isUnder(file, 'src/core/stores') && isUnder(target, 'src/core/stores')) {
            report(file, sourceFile, node, `core 禁止依赖 stores/（${specifier}）`);
        }
        if (['src/popup', 'src/background', 'src/content'].some(entry => isSameModule(target, entry))) {
            report(file, sourceFile, node, `core 禁止依赖入口文件（${specifier}）`);
        }
    }

    if (typeOnly) return;

    // 聚合层同时导出两套实现：从 karplus / soundfont 导入它等于间接互相依赖。
    const isPlaybackBarrel = isSameModule(target, 'src/features/playback/index')
        || isSameModule(target, 'src/features/playback');
    if (isUnder(file, 'src/features/playback/karplus')
        && (isUnder(target, 'src/features/playback/soundfont') || isPlaybackBarrel)) {
        report(file, sourceFile, node, `karplus 实现不得导入 soundfont 实现（${specifier}）`);
    }
    if (isUnder(file, 'src/features/playback/soundfont')
        && (isUnder(target, 'src/features/playback/karplus') || isPlaybackBarrel)) {
        report(file, sourceFile, node, `soundfont 实现不得导入 karplus 实现（${specifier}）`);
    }
}

function checkStaticModules(file, sourceFile) {
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            checkModuleSpecifier(
                file,
                sourceFile,
                statement,
                statement.moduleSpecifier.text,
                isTypeOnlyImport(statement),
            );
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier
            && ts.isStringLiteral(statement.moduleSpecifier)) {
            checkModuleSpecifier(
                file,
                sourceFile,
                statement,
                statement.moduleSpecifier.text,
                isTypeOnlyExport(statement),
            );
        }
    }
}

/** 收集本文件声明的名字；同名局部变量不是 DOM 全局。 */
function collectDeclaredNames(sourceFile) {
    const names = new Set();

    const addBindingName = name => {
        if (ts.isIdentifier(name)) {
            names.add(name.text);
        } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
            for (const element of name.elements) {
                if (ts.isBindingElement(element)) addBindingName(element.name);
            }
        }
    };

    const visit = node => {
        if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
            addBindingName(node.name);
        }
        if ((ts.isImportClause(node)
            || ts.isNamespaceImport(node)
            || ts.isImportSpecifier(node)
            || ts.isFunctionDeclaration(node)
            || ts.isFunctionExpression(node)
            || ts.isClassDeclaration(node)
            || ts.isClassExpression(node)
            || ts.isEnumDeclaration(node)
            || ts.isTypeAliasDeclaration(node)
            || ts.isInterfaceDeclaration(node)) && node.name) {
            names.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return names;
}

/** 标识符是否处于类型位置（`let ctx: AudioContext` 不产生运行时副作用）。 */
function isInTypePosition(node) {
    let current = node.parent;
    while (current) {
        if (ts.isTypeNode(current)) return true;
        if (ts.isQualifiedName(current)) {
            current = current.parent;
            continue;
        }
        return false;
    }
    return false;
}

/** 判断标识符是「被引用」而非声明名/属性名，避免把字段名当成 DOM 全局。 */
function isReferenceIdentifier(node, declaredNames) {
    const parent = node.parent;
    if (!parent) return true;

    if (declaredNames.has(node.text)) return false;
    if (isInTypePosition(node)) return false;

    if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAccessChain(parent))
        && parent.name === node) {
        return false;
    }
    if (ts.isQualifiedName(parent) && parent.right === node) return false;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
    if ((ts.isPropertyDeclaration(parent)
        || ts.isPropertySignature(parent)
        || ts.isMethodDeclaration(parent)
        || ts.isMethodSignature(parent)
        || ts.isFunctionDeclaration(parent)
        || ts.isClassDeclaration(parent)) && parent.name === node) {
        return false;
    }
    if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
    if (ts.isParameter(parent) && parent.name === node) return false;
    if (ts.isBindingElement(parent) && parent.name === node) return false;
    if (ts.isImportSpecifier(parent)
        || ts.isExportSpecifier(parent)
        || ts.isImportClause(parent)
        || ts.isNamespaceImport(parent)
        || ts.isNamespaceExport(parent)) {
        return false;
    }
    return true;
}

const FORBIDDEN_GLOBALS = new Set([
    'document', 'window', 'self', 'globalThis', 'AudioContext', 'chrome',
    'fetch', 'localStorage', 'sessionStorage', 'navigator',
]);

function checkFile(file, sourceFile) {
    checkStaticModules(file, sourceFile);
    const declaredNames = collectDeclaredNames(sourceFile);

    const visit = node => {
        if (isUnder(file, 'src/core')
            && ts.isIdentifier(node)
            && FORBIDDEN_GLOBALS.has(node.text)
            && isReferenceIdentifier(node, declaredNames)) {
            report(file, sourceFile, node, `core 禁止副作用：${node.text}`);
        }

        // 动态 import 也走同一套目标检查；它不是 type-only。
        if (ts.isCallExpression(node)
            && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments.length === 1
            && ts.isStringLiteralLike(node.arguments[0])) {
            checkModuleSpecifier(file, sourceFile, node, node.arguments[0].text, false);
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
}

const files = await collectSourceFiles(srcDir);
for (const file of files) {
    const source = await readFile(file, 'utf8');
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(file),
    );
    checkFile(file, sourceFile);
}

if (errors.length > 0) {
    console.error(`[lint:layers] 发现 ${errors.length} 处越层/副作用：`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
}

console.log(`[lint:layers] OK：${files.length} 个文件，层级与副作用边界均通过。`);
