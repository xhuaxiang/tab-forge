/**
 * 本地即兴生成 — core 侧收口。
 *
 * 只导出编排入口与选项解析；中间表示（节奏/骨架/把位）供测试与后续
 * 扩展直接导入具体模块，不从 index 再铺一层。
 */

export {
    generateLocalImprovisation,
    resolveLocalImprovOptions,
} from './generate.ts';
export { parseImprovDescription } from './description.ts';
