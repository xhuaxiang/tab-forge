# Tab Forge — 项目上下文与编码规则

## 项目简介

吉他六线谱扒谱工具（Chrome MV3 扩展 + 网页双构建，Vite + TypeScript strict）。
- 数据模型：`src/types/`（Note / Measure / Tuning / TabScore）
- 状态：`src/stores/`（scoreStore / uiStore），数据变更通过 onChange 自动触发渲染
- 渲染：`src/canvas/`（Canvas 六线谱）、`src/alphaTab/`（alphaTab 专业渲染 + 点击编辑 + SoundFont 播放）
- 播放：统一 `src/playback/`（Karplus-Strong 合成 `karplus/`、alphaTabPlayer SoundFont `soundfont/`）, 在 index.ts 输出
- 即兴：`src/improvisation/`（AI 生成）
- 配置: `src/config.ts`
- 构建：`vite.config.ts`（扩展 → dist/）、`vite.web.config.ts`（网页 → dist-web/）

## 编码规则

### 1. 优先 ES6+（现代 TypeScript 语法）
- `const`/`let`（不用 `var`）、箭头函数、模板字符串、解构、可选链 `?.`、空值合并 `??`、类字段、`async/await`
- 用 `import type` 做纯类型导入（`verbatimModuleSyntax` 已开启）
- 枚举/命名空间用 alphaTab 等库的，业务代码尽量用字面量联合类型

### 2. 模块化：数据、操作、工具分层，各司其职
- **数据**（状态/模型）：`src/stores/`、`src/types/`、`src/config.ts` —— 只存数据与状态变更，不碰 DOM/渲染
- **操作**（业务/事件）：`src/eventHandlers.ts`、`src/alphaTab/scoreEditing.ts` 等 —— 桥接事件与 store 动作，不直接操作数据内部
- **工具**（纯函数/可复用）：统一 `src/utils/`（含 scoreMapping 等纯映射）—— 无副作用、无 DOM，可独立单测；其他模块不内联重复实现
- **播放**：统一 `src/playback/`，Karplus-Strong 合成（`karplus/`）与 alphaTabPlayer SoundFont（`soundfont/`）**分开**，互不混入，与渲染解耦
- 跨层调用单向：事件 → store 动作 → 变更通知 → 渲染；渲染器/播放器各自独立模块，互相不混入
- 配置统一放 `src/config.ts`，不散落硬编码默认值
