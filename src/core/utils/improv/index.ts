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
export {
    detectUnsupportedDescription,
    detectUnsupportedDescriptionItems,
    parseDescriptionChordChart,
    parseDescriptionFretRange,
    parseImprovDescription,
} from './description.ts';
export {
    buildChordChart,
    chordChartFromBars,
    formatChordSpec,
    formatProgression,
    formatProgressionStep,
    normalizeChordChart,
    parseChordChartText,
    parseProgressionText,
    parseProgressionToken,
    progressionEquals,
} from './progression.ts';
export { fingeringFretRange } from './fingering.ts';
export { applyPracticeProfile } from './practice.ts';
export { mergeImprovOptions } from './mergeOptions.ts';
export {
    applyPerformancePatches,
    indexImprovSlots,
    serializeImprovSlots,
} from './performancePatch.ts';
export type {
    PatchApplyResult,
    RejectedPatch,
    SerializedImprovNote,
    SerializedImprovSlot,
} from './performancePatch.ts';
