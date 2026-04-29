# TypeScript + Preact 迁移设计

Last updated: 2026-04-15

Status: draft

这份文档定义如何用 TypeScript 和 Preact 降低技术债。目标不是追求新技术栈本身，而是把当前全局脚本、隐式消息协议、手写 DOM 状态和大文件职责拆开，让后续重构更可控。

## 目标

- 用 TypeScript 明确消息协议、历史记录、设置项、运行诊断和 provider 配置。
- 用 Preact 收敛 `popup`、`reader`、`sidebar` 的 UI 状态和渲染逻辑。
- 保持 Manifest V3 形态、隐私边界和用户可见功能不变。
- 每一步都能被现有 Node + Playwright 测试验证。

## 不做

- 不一次性重写整个插件。
- 不把 `background`、`content`、`db`、`shared`、`adapters` 框架化。
- 不在同一批改动里同时做 UI 重写、存储 schema 迁移和产品功能升级。
- 不为了构建系统牺牲扩展可审计性：产物入口、权限和 `web_accessible_resources` 必须清晰。

## 当前判断

TypeScript 可以先上，而且应优先上。它可以在不改变运行产物的前提下暴露隐式契约问题。

Preact 也可行，但应限定在 UI 页面。推荐迁移顺序是 `popup` -> `reader` -> `sidebar`。`sidebar` 最大、状态最多，必须先拆纯逻辑和状态边界，再组件化。

## 分阶段计划

### Phase 1：类型检查先行

目标：引入 TypeScript 基础设施，但不改变扩展运行方式。

动作：

- 增加 `typescript`、`tsconfig.json` 和 `npm run typecheck`。
- 先启用 `allowJs` + `checkJs`，让现有 JS 参与类型检查。
- 给关键全局对象和 Chrome API 交互补最小类型声明。
- 不改 `manifest.json`、HTML 脚本顺序和运行产物。

验收：

- `npm.cmd test` 通过。
- `npm.cmd run typecheck` 通过。
- 如未改浏览器入口，可暂不跑 E2E；改了入口契约则必须跑 `npm.cmd run test:e2e`。

### Phase 2：核心类型建模

目标：先锁住跨模块契约，减少后续 UI 和后台拆分风险。

优先定义：

- `types/messages.ts`：`chrome.runtime.sendMessage` / port 消息 action 和 payload。
- `types/history.ts`：文章快照、总结记录、阅读会话。
- `types/settings.ts`：用户设置、provider preset、endpoint mode。
- `types/diagnostics.ts`：错误码、重试、取消、传输诊断。

约束：

- 类型应来自现有行为，不借机重命名字段。
- 如果发现字段含义不清，先补注释和测试，再改实现。

### Phase 3：纯逻辑 TS 化

目标：先迁移低风险、可单测的模块。

推荐顺序：

- `shared/domain.js`
- `shared/errors.js`
- `shared/run-utils.js`
- `shared/trust-policy.js`
- `shared/article-utils.js`
- `shared/transport-utils.js`
- `adapters/`
- `db.js`

约束：

- 迁移时保持浏览器全局兼容，直到构建链正式接管。
- 每迁移一组模块，补齐或保留 Node 单测。
- 不在这一步引入 Preact。

### Phase 4：构建链接入

目标：引入可控的多入口构建，让 TS 和 Preact 可以稳定产出 MV3 扩展文件。

建议：

- 使用 Vite 或 Rollup 多入口构建。
- 输出目录使用 `dist/`。
- 入口保持清晰：`background`、`content`、`popup`、`sidebar`、`reader`。
- Playwright 增加加载 `dist/` 的能力；构建版通过后再考虑切换默认加载目录。

验收：

- `npm.cmd run build` 通过。
- `npm.cmd test` 通过。
- Playwright 能加载构建产物并通过主链路。

### Phase 5：Preact 迁移 popup

目标：用最小 UI 页面验证框架接入方式。

范围：

- 设置表单状态。
- provider preset 联动。
- 自动保存。
- 连接测试。
- 入口状态检查。

约束：

- 保留现有关键 DOM id 或测试选择器。
- 不做视觉重设计。
- 不改变设置字段和保存策略。

### Phase 6：Preact 迁移 reader

目标：把阅读页的 session fallback、Markdown 渲染、诊断展示拆成组件。

推荐组件：

- `ReaderApp`
- `ReaderHeader`
- `MarkdownView`
- `DiagnosticsPanel`
- `EmptyState`
- `SourceLink`

约束：

- 保持无会话、历史记录缺失、无来源链接、取消/失败记录等异常路径行为不变。

### Phase 7：sidebar 分层后组件化

目标：最后处理最大文件，避免把复杂度直接搬进组件。

先拆纯逻辑：

- 历史 store 和过滤逻辑。
- 生成状态机。
- reader session builder。
- export/share helpers。
- 诊断映射。

再拆 UI：

- `SummaryPanel`
- `HistoryPanel`
- `SiteFilterBar`
- `GenerationControls`
- `DiagnosticsBanner`
- `ExportPanel`

约束：

- 每次只迁移一个面板或一组状态。
- `重新生成` 必须继续使用当前页面上下文，而不是旧历史快照。
- 历史、收藏、删除、站点过滤、reader 打开路径必须全量回归。

## 目标目录

```text
src/
  manifest.json
  background/
    index.ts
  content/
    index.ts
  shared/
  adapters/
  db/
    record-store.ts
  types/
    messages.ts
    history.ts
    settings.ts
    diagnostics.ts
  ui/
    popup/
      main.tsx
      App.tsx
    reader/
      main.tsx
      App.tsx
    sidebar/
      main.tsx
      App.tsx
dist/
```

这是目标结构，不要求第一阶段立即迁移到 `src/`。

## 质量门禁

默认门禁：

```powershell
npm.cmd test
npm.cmd run typecheck
```

涉及 Manifest、HTML、构建产物、popup、sidebar、reader、background 或 content 入口时，额外运行：

```powershell
npm.cmd run test:e2e
```

构建链落地后增加：

```powershell
npm.cmd run build
```

## 推荐第一批提交

1. `build: add TypeScript typecheck`
2. `types: define extension contracts`
3. `refactor: type shared domain utilities`
4. `build: add extension build pipeline`
5. `test: run e2e against built extension`
6. `ui: migrate popup to Preact`

第一批只做类型和构建护栏，不直接迁移 `sidebar`。
