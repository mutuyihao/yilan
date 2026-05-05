# TypeScript + React 迁移评估与执行计划（Yilan）

Last updated: 2026-05-05

Status: draft

## 摘要（是否有必要）
- 结论：在你的目标组合（长期可维护 + 复杂 UI 持续迭代 + 团队协作 + 可接受构建链 + 必须 React）下，迁移到 **TS + React** 是“值得做且可行”的，但必须 **分阶段**，先把构建/产物/测试护栏做稳，再逐页迁移 UI，最后完成全仓 TS 化与旧架构下线。
- 当前仓库已落地的是 `allowJs + checkJs` 的 `npm.cmd run typecheck`、`types/*` 契约文件、Node 单元测试和 Playwright 主链路；还没有把 `dist/` 作为运行事实来源，也没有引入 React 或构建产物加载。
- 关键硬约束：
  - MV3 background 是 **extension service worker**：若想使用 ES module `import`，需要在 manifest 里声明 `type: "module"`；同时 **不支持动态 `import()`**（只支持静态 import）。([developer.chrome.com](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics?authuser=2&utm_source=openai))
  - 你偏好的开发方式（watch + reload）可以直接用 `vite build --watch`。([vite.dev](https://vite.dev/guide/build?utm_source=openai))
- 替代方案（不选，仅作为对照）：只做 TS typecheck + 继续模块化（不引入 React/构建）能解决一部分债，但无法从根上解决 UI 复杂度、组件复用与多人协作成本。

## 影响面（收益 / 成本 / 风险）
- 收益
  - 类型层：把“消息协议、settings、history、diagnostics、adapter contracts”从隐式 JS 约定变成可演进的显式接口，降低重构回归与跨模块误用。
  - UI 层：React 统一状态与渲染模型，减少手写 DOM 状态机与大文件拆分成本，利于后续做“资料库化”（标签/备注编辑、复杂筛选、批量操作、更多视图）。
  - 工程层：把“入口契约（manifest/resources/脚本顺序）”从人工维护变成构建产物约束，减少脚本顺序/全局变量依赖的脆弱性。
- 成本
  - 引入构建链与 `dist/` 成为事实来源：本地开发、E2E、发布都要适配。
  - 调试方式变化：source map/构建产物定位问题成为常态。
- 主要风险与规避
  - Service worker 的动态 import 限制：禁止在 background 使用 `import()`，并让构建保证 background 不产生动态加载路径。([chromium.googlesource.com](https://chromium.googlesource.com/chromium/src/%2B/HEAD/content/browser/service_worker/es_modules.md?utm_source=openai))
  - Rollup “单文件内联动态导入”与“多入口”冲突：`output.inlineDynamicImports` **只能单入口**，因此 background/content 需要独立构建或独立入口策略。([rollup.nodejs.cn](https://rollup.nodejs.cn/configuration-options/?utm_source=openai))
  - content script 的模块化限制：不要依赖“content script 里直接写静态 import”；统一用 bundler 输出单文件 content 脚本（或采用明确的动态 import + WAR 声明，但优先不走这条）。([stackoverflow.com](https://stackoverflow.com/questions/48104433/how-to-import-es6-modules-in-content-script-for-chrome-extension/56783515?utm_source=openai))
  - 依赖库的 CSP/worker 环境不兼容：在选型上避免需要 `eval`、DOM、XMLHttpRequest 的库进入 background。

## 迁移路线（分阶段，可逐步发版）
阶段目标是“每一阶段都可交付、可回滚、可验收”，不把产品功能升级和框架迁移混在同一批。

### Phase 0：冻结契约与验收门禁（1-3 天）
- 锁定当前行为的验收清单：
  - Node：现有 `node tests/run-tests.js`
  - TS：现有 `npm.cmd run typecheck`
  - E2E：现有 Playwright 主链路（popup 保存/自动保存/连接测试、注入侧栏、生成、历史复用、导出、reader）。
- 产物与入口基线：
  - 明确未来以 `dist/` 为加载目录；根目录脚本进入“过渡期保留，但不再新增特性”。

验收：当前 Node + E2E 全绿；基线手工烟测清单可执行。

### Phase 1：构建链落地（先不改业务逻辑）（1-2 周）
- 技术选型（决策已锁定）：
  - UI：Vite + React（多页）用于 `popup/reader/sidebar`。Vite 多页通过 `build.rollupOptions.input` 声明多 HTML 入口。([v4.vite.dev](https://v4.vite.dev/guide/build.html?utm_source=openai))
  - Core（background/content）：单独构建，保证：
    - background：不产生动态 `import()`；如使用 ESM 静态 import，manifest 加 `type:"module"`；否则输出单文件 classic/IIFE。([developer.chrome.com](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics?authuser=2&utm_source=openai))
    - content：输出单文件，不依赖静态 import。([stackoverflow.com](https://stackoverflow.com/questions/48104433/how-to-import-es6-modules-in-content-script-for-chrome-extension/56783515?utm_source=openai))
- 输出结构（最终稳定形态）：
  - `dist/manifest.json`、`dist/popup.html`、`dist/reader.html`、`dist/sidebar.html`、`dist/background.js`、`dist/content.js` 等稳定入口文件。
  - icons/libs 等静态资源进入 Vite `public/`，由 Vite 原样拷贝到 `dist/`（保证文件名稳定、无需 hash）。([vite.dev](https://vite.dev/config/shared-options/?utm_source=openai))
- Dev flow：
  - `npm.cmd run dev`（或等价）= 并行执行多个 `vite build --watch`（UI + background + content），然后手动或脚本触发扩展 reload。([vite.dev](https://vite.dev/guide/build?utm_source=openai))
- 测试适配：
  - Playwright harness 从加载 repo 根目录改为加载 `dist/`。
  - 静态契约测试改为校验 `dist/manifest.json` 及 `dist/` 下资源存在性。

验收：不改任何产品行为的前提下，`dist/` 可被浏览器 Load unpacked；Node + E2E 全绿。

### Phase 2：全仓 TS 化（不要求一次 strict）（2-6 周，持续）
- 先迁“纯逻辑高复用层”：shared 工具、adapters、transport、domain、errors、run-utils、trust-policy、url utils。
- 再迁“存储与后台编排”：db、background（注意 SW 环境限制，避免引入 DOM/动态 import）。([developer.chrome.com](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics?authuser=2&utm_source=openai))
- TS 策略：
  - 新 TS 文件默认开启更严格规则；旧 JS/旧 TS 文件允许逐步提升（以“每次改动不扩大红线”为原则）。
  - 引入 `@types/chrome` 与最小自维护类型层，保持消息协议在 `types/*`（或 `src/types/*`）为单一事实来源。

验收：TS 编译产物完整替代旧 JS 入口；类型门禁稳定；不新增运行时行为差异。

### Phase 3：React 迁移 UI（按页面从小到大）（4-10 周，持续）
迁移顺序与策略（强约束）：
- 先 `popup`（最小面、状态相对集中）
- 再 `reader`
- 最后 `sidebar`（最大、状态最多）

每一页的迁移要求：
- 先把现有 UI 逻辑拆成 “纯 view model + UI 渲染层”，再把 UI 渲染层换成 React。
- 关键选择器/DOM contract：
  - Playwright 依赖的 `#apiKey/#baseURL/#modelName/#testBtn` 等必须保持，或同步升级测试选择器与静态契约。
- 样式策略：
  - 先“像素级等价”，不在迁移批次里做视觉重设计（降低回归面）。

验收：每迁移一个页面，Node + E2E 全绿；手工烟测通过；性能与包体无明显倒退（给出基准：加载时间、内存占用、bundle size）。

### Phase 4：下线旧无构建结构（收尾）
- 删除根目录旧页面/脚本的“运行时入口”角色，只保留源码在 `src/`。
- 文档与贡献指南统一以 `dist/` 为准；发布脚本固定从 `dist/` 打包。

验收：仓库结构清晰、无双入口；任何变更都必须通过构建与测试才能被加载。

## 测试计划（每阶段必跑）
- 必跑：
  - Node：现有 `node tests/run-tests.js`
  - TS：`npm.cmd run typecheck`（或迁移后的等价命令）
  - E2E：Playwright 主链路（确保 `dist/` 形态也跑通）
- 必测场景（针对迁移风险）：
  - background 不含动态 import；SW 启动/事件监听正常。([chromium.googlesource.com](https://chromium.googlesource.com/chromium/src/%2B/HEAD/content/browser/service_worker/es_modules.md?utm_source=openai))
  - popup 自动保存/连接测试/错误展示仍一致。
  - content 注入 + sidebar iframe 注入 + SPA 路由刷新仍一致。
  - reader session 恢复路径与失效回退不变。
  - 类型契约继续覆盖 `types/messages.ts`、`types/history.ts`、`types/settings.ts`、`types/diagnostics.ts`。

## 假设与已锁定决策
- 目标浏览器：仅 Chromium（Chrome/Edge）。
- UI 框架：必须 React。
- 开发方式：`vite build --watch` + 扩展 reload（不依赖 dev server/HMR）。
- 迁移范围：最终全仓 TS 编译产物接管（background/content/shared/adapters/db/ui 全部进入构建链）。
- 迁移原则：行为等价优先；不混合产品功能大改与框架迁移。
