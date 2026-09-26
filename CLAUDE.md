# Tab Forge — 项目上下文与编码规则

吉他六线谱扒谱工具：Chrome MV3 扩展 + 网页双构建，Vite + TypeScript strict。

## 项目速览

- **双构建**：扩展 `vite.config.ts → dist/`、网页 `vite.web.config.ts → dist-web/`，公共配置 `vite.base.config.ts`；两者共用入口 `src/popup.ts`，`src/background.ts` / `src/content.ts` 仅扩展侧。
- **四层**：入口 → `src/app/` → `src/core/stores/` → `src/core/` 其余。
  - **入口**（`src/popup.ts` / `background.ts` / `content.ts`）是组合根：只做接线（`setOnChange`、初始化），不放业务逻辑，可直接读写 store。
  - **`src/app/`**：事件桥接、渲染协调。
  - **`src/core/`**：不碰副作用的全部逻辑 —— `types/`（类型与数据常量）、`stores/`（状态与动作）、`utils/`（纯函数）、`config.ts`（可调配置）。
  - **表现层**（由 `app/` 驱动）：`src/features/canvas|alphaTab/`（两种渲染）、`src/features/playback/karplus|soundfont/`（两种播放）、`src/features/ai/`（即兴）。
- **测试**：`src/tests/`，镜像 `src/` 层级（vitest）。
- **命令**：`npm run dev` / `dev:web`、`npm run build` / `build:web`、`npm test`。

> **先查再写**：本文档不列文件清单，也不列已有工具函数 —— 一重构就腐坏。动手前先 `Glob` / `Grep` 看现场，尤其是 `core/utils/`（拍位、小节容量、时值、调弦、导出等换算已沉淀在那，别内联第二份）。

## 归属判断：新增文件时的判断规则

**判断该文件是否碰 DOM / AudioContext / 网络这类副作用：**

- **不碰** → `src/core/`（types / stores / utils / config）
- **碰** → `src/app/` 或 `src/features/*/`

遇到拿不准的情况，停下来问我，不要猜；也不要为了迁就规则把代码掰成不自然的样子。

## 动手时：按你正在做的动作查

规则只有在对上你当下的动作时才会生效，所以下面按动作组织，不按架构维度。

**新增 `core/utils/` 函数时**
签名里只应出现 `core/types` 的类型、原始值，以及第三方库的类型/纯函数（例如 alphaTab 的 `model` 类型）。若它需要读 store 或碰 DOM，则它不属于 `utils`，应放到 `features/` 下。

**工具是通用的，别按「哪边用」拆**
成对的换算（弦号双向、时值双向…）放在一起、**共用一份实现**，不要因为一端是自研、另一端是 alphaTab 就分成两节或两个文件——分开写只会各自漂移。
`canvas ↮ alphaTab`、`karplus ↮ soundfont` 这条管的是**实现**互不混入，管不到 `core/utils/`：那里的函数两边都可以 import。

**改已经在 store 里的数据时**
先 `Grep` 找 `scoreStore` / `uiStore` 里对应的动作，调它；找不到就先加一个动作，不要在调用处改字段。

> ⚠️ **违反信号**：当你写 `xxx.field = ...` 且 `xxx` 来自 store 时——停下，去找动作。

渲染器**可以读** store（高亮、选中联动），但改数据只能走动作。

**加一个可调数字时**
进 `src/core/config.ts`（BPM、拍号、音阶/风格/密度列表、模型名、温度、endpoint 等）。
是「数据」而非「可调参数」的（如 `STANDARD_TUNING`）才放 `core/types/`。

**改 AI 输出格式时 —— 三处必须对齐，漏一处静默丢音符**
1. `core/types/index.ts` 的 `Note`（全集）
2. `features/ai/noteContract.ts`（暴露给 AI 的子集）
3. `features/ai/responseParser.ts` 的 `sanitizeNote`（校验；白名单目前是内联字面量）

> 只改一边的后果是**不报错、不提示，音符直接消失**。改完逐个回去核对。

**新增 import 时**
不用现场判层——先写。层级越界由交付前的自检命令兜（见文末）。

## 不可机检的硬约束

1. **依赖方向单向**：事件/DOM → `app/` → store 动作 → `onChange` → 渲染/播放。
   - **例外：`uiStore` 不设 `onChange`**。它装的是 UI 临时态（技法、推弦幅度、和弦品位、播放状态），状态由按钮自身反映，没有「数据变了要重渲染」的外部观察者；`scoreStore` 才有 `setOnChange` / `setOnSelectChange`。给 `uiStore` 加通知是**可选**的严格化，不是欠债——别当 bug 顺手补。
2. **两种实现互不混入**：`canvas/` 与 `alphaTab/` 互不导入；`playback/karplus/` 与 `playback/soundfont/` 互不导入。类型契约可经各自 `index.ts` 共享，**实现**不得互导。
3. **双构建都成立**：新代码要在 dist/ 与 dist-web/ 都能跑；扩展 API 用兼容判断（`typeof chrome !== 'undefined'` 已有先例），静态资源放 `public/`。

> 「core 无副作用」「core 不得依赖 app/features/stores」「canvas↮alphaTab」「karplus↮soundfont」这几条本可完全机检，已挪进下面的自检命令。别只当它们是不成文约定。

## 规则冲突与结构调整

本文档描述的是**目标态**，不是现状。现状与规则的差距**不要在顺手时修**。

### 默认模式：功能开发

规则与现有代码冲突时，**以规则为准写新代码，老债不动**：

- 只改本次任务涉及的文件，不顺手重构无关代码。
- 发现的越层 / 重复实现 / 硬编码：在**回报里单列「规则冲突」一节**（file:line + 违反哪条 + 建议动作），不在本次任务里修，也不落成文件。
- 若一处老债挡住了本次任务（不改就写不下去），停下来问我，不要自行扩大范围。

### 重构模式：仅当我说了才开启

触发条件：我说「重构 / 调整结构 / 搬家 / 分层 / 清债」这类话才算。**默认关闭，你不要自己判定进入。**

1. **先冻结范围**：动手前列出「动哪些 / 不动哪些 / 目标边界是什么」，等我确认。一次只处理一个模块或一种边界，不叠加第二件事。
2. **行为不变**：`npm test` 前后都必须全绿，且**断言不改**（只允许机械修正 import 路径）。改了断言 = 改了行为，那就不是重构。
3. **顺序固定**：移动文件 → 修 import → `build` + `test` → 删旧位置残留。
4. **用「语义」判范围，不用「文件数」**：搬家改一百个 import 属于一个改动；重写某个函数逻辑不算。
5. **范围外的债只报告不修**，哪怕路过看见。
6. **规则本身也可能是错的**：若某文件本就不属于所在层（是规则写错了，不是代码写错了），停下来给我两个选项 ——「改代码迁就规则」还是「改规则承认现状」—— 由我裁决。
7. **收尾**：把这次确立的新边界同步进本文档。

## 软提示（风格建议）

- ES6+ 优先，看使用场景。
- 业务代码用字面量联合类型，不自造 `enum`（alphaTab 等库的枚举照用，那是消费第三方）。

## Commit 规范

- `type: 中文描述`；type 用 `feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `ci`，必要时带范围写成 `type(scope):`（如 `docs(CLAUDE.md)`），提交内容一句话概括，不要写文章。

## 加新功能时，按这条链过一遍

1. **数据**：新字段先定在 `core/types/`，列清谁读谁写。
2. **纯算法**：能纯化的下沉 `core/utils/`，配单测。
3. **状态**：变更走 `core/stores/` 动作；批量改动包在 `beginBatch`/`endBatch` 里，别逐条触发重渲染。
4. **配置**：可调默认值进 `core/config.ts`。
5. **桥接**：DOM 事件进 `app/eventHandlers.ts` 或对应 `features/*/*Editing.ts`。
6. **表现**：渲染进 `features/canvas|alphaTab/`，播放进 `features/playback/`，各自 `index.ts` 收口。

不是每一步都要做，而是每一步都逐项判断本次是否需要改动。

## 什么时候派谁

- 重构 / 新功能方案 → `designer`（只读，出实施计划）
- 按计划落地 → `implementer`
- 交付前审查 → `reviewer`；AI 契约类改动加 `reviewer-mm` 做第二意见
- 六线谱模型 / 渲染 / 播放专项 → `tab-expert`
- 纯函数补测 → `test-writer`

## 交付前自检

- `npm run build` / `npm run build:web` / `npm test` 三条全过。
- 层级自检 —— 以下三条命令均应**输出为空**（已实测，当前三条均输出为空）：
  ```bash
  grep -rn "document\.\|AudioContext\|chrome\.\|fetch(" src/core/
  grep -rn "from '.*\(app\|features\|stores\)/" src/core/
  grep -rn "from '\.\./\(karplus\|soundfont\)/" src/features/playback/ | grep -v "import type"
  ```
- 改了 `core/types/` 或 AI 契约：回报里列波及文件（file:line）。
- 新增纯函数：`src/tests/` 有对应测试（确定性输入输出、无 DOM 即必须测）。

## 待办（提示词已就位，机制尚未接）

- `npm run lint:layers`（dependency-cruiser 或 eslint `no-restricted-paths`）尚未接入。接入后，上面三条 grep 自检升格为闸门，人工自检可删。
