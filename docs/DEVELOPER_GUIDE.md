# 开发者指南

Last updated: 2026-05-05

这份文档面向在当前仓库里改代码的人，重点说明三件事：先看哪些文档、修改后怎么验证、哪些事实应该写回哪份文档。

## 建议阅读顺序

1. [文档索引](README.md)
2. [项目概览](../README.md)
3. [测试体系](TESTING.md)
4. [技术架构](TECHNICAL_ARCHITECTURE.md)
5. [升级设计（draft）](UPGRADE_DESIGN.md)
6. [TypeScript + React 迁移设计（draft）](TS_REACT_MIGRATION.md)
7. [协作与贡献](../CONTRIBUTING.md)

## 本地开发

### 加载扩展

1. 打开 Chromium 浏览器扩展管理页。
2. 打开“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 指向项目根目录。

### 修改后刷新

1. 修改代码或文档。
2. 在扩展管理页点击刷新扩展。
3. 如果改动涉及 `content.js`、`sidebar.html`、`sidebar.js`、`style.css` 或注入逻辑，额外刷新目标网页。
4. 如果改动涉及 `popup.html` 或 `popup.js`，重新打开 popup。
5. 如果改动涉及 `reader.html` 或 `reader.js`，重新打开独立阅读页。

## 推荐验证流程

### 1. 基础验证

```powershell
npm test
```

`npm test` 会跑 Node 层测试，并附带一方 JavaScript 文件的语法检查、功能覆盖矩阵和静态契约检查。当前 Node 层还覆盖后台 entrypoints / run-state / reader-sessions，以及侧栏拆分后的 state / generation / render / events / export / reader-session / mode-control 控制器。

### 2. TypeScript 契约检查

```powershell
npm run typecheck
```

`npm run typecheck` 只做 `tsc --noEmit` 契约检查，不生成构建产物。涉及消息协议、记录结构、设置项、诊断或 provider 配置时应与 `npm test` 一起运行。

### 3. 浏览器主链路回归

```powershell
npm run test:e2e
```

首次运行 Playwright 前，通常需要先安装 Chromium：

```powershell
npm run playwright:install
```

### 4. PowerShell 兼容写法

如果 Windows PowerShell 拦截 `npm.ps1`，可改用：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:e2e
npm.cmd run playwright:install
```

如果只需要 Node 层入口，也可以直接运行：

```powershell
node tests/run-tests.js
```

## 验证分工

- `npm test`：纯逻辑、存储层、静态契约、功能覆盖矩阵门禁。
- `npm run typecheck`：TypeScript 契约和当前 JS 的 `checkJs` 门禁，不改变运行产物。
- `npm run test:e2e`：真实 Chromium 中的 popup、content script、background service worker、sidebar iframe、reader 页面与 mocked AI 链路。
- 手工回归：主题视觉、浏览器受限页面、稀有 provider / endpoint 组合、快捷键设置页跳转等不适合全部固化成 E2E 的路径。

## 手工回归清单

对用户可见改动，除了自动化之外，至少补受影响路径的人工确认。当前 Playwright 已覆盖 popup 自动保存与连接测试、主摘要生成、长文分段、历史复用、隐私/分享策略、取消生成、导出下载和阅读页打开，但以下场景仍建议手工确认：

### 设置页

- 标签切换正常。
- 主题切换能同步到 popup、侧栏和阅读页。
- “检查入口”和“快捷键设置”仍能给出正确状态或跳转。
- 厂商 preset、Provider、Endpoint Mode 的非常见组合仍能得到合理表单状态。
- `Endpoint Mode = 自动判断` 的连接测试能在兼容网关上给出清晰诊断；如果网关需要补齐或去除 `/v1`，设置页能同步修正结果。
- 配置方案（profiles）能正常创建 / 另存为 / 重命名 / 删除，绑定提示与禁用态正确。
- 模型列表刷新按钮能在 OpenAI 兼容接口成功连接后拉取并缓存输入提示；Anthropic 兼容接口应给出“不支持自动拉取，手动输入模型 ID”的合理提示。

### 侧栏与历史

- 右键菜单和 `Alt + S` 能打开侧栏。
- 历史搜索、站点聚合、收藏、删除互相配合正常。
- “优先显示本页历史摘要”命中后，点击“重新生成”仍基于当前页面，而不是旧记录快照。
- 浏览器内部页面、扩展商店页等受限页面的行为符合浏览器权限预期。

### 阅读与导出

- 阅读页中的复制、原文跳转、布局和明暗主题正常。
- Markdown 导出内容结构正确，来源信息没有缺失。
- 分享长图下载后的视觉样式没有因 CSS 调整被破坏。

## 常见修改入口

### 页面抽取和页面策略

优先查看：

- `content.js`
- `shared/article-utils.js`
- `shared/page-strategy.js`
- `shared/domain.js`

### Provider / Endpoint 适配

优先查看：

- `shared/provider-presets.js`
- `shared/transport-utils.js`
- `shared/url-utils.js`
- `adapters/openai-adapter.js`
- `adapters/anthropic-adapter.js`
- `adapters/registry.js`
- `background.js`

原则：provider-specific 请求格式优先放进 `adapters/`，不要把兼容分支堆回后台主流程。连接测试里的自动 endpoint 试探、模型列表刷新、`/v1` 自动修正和本地缓存属于后台编排能力，仍保留在 `background.js` 与共享 URL / transport 工具中。

### 后台运行与取消

优先查看：

- `background.js`
- `background/entrypoints.js`
- `background/run-state.js`
- `background/reader-sessions.js`
- `shared/abort-utils.js`
- `shared/transport-utils.js`

原则：右键菜单、快捷键和入口状态归 `background/entrypoints.js` 管理；active runs、port-run 映射和取消状态归 `background/run-state.js` 管理；阅读页临时会话归 `background/reader-sessions.js` 管理；请求执行、重试和 transport 错误归一仍留在后台主流程与共享 transport 工具中。

### 侧栏 UI 与阅读体验

优先查看：

- `sidebar.html`
- `sidebar.js`
- `sidebar/export.js`
- `sidebar/reader-session.js`
- `sidebar/generation.js`
- `style.css`
- `reader.html`
- `reader.js`

原则：历史面板归 `sidebar/history.js`，Markdown 导出和分享卡归 `sidebar/export.js`，阅读页打开归 `sidebar/reader-session.js`，生成、取消和流式连接归 `sidebar/generation.js`；继续拆侧栏时优先通过依赖注入创建控制器，不让新模块直接读取 `sidebar.js` 的局部状态。

### 设置页与自动保存

优先查看：

- `popup.html`
- `popup.js`
- `shared/theme.js`
- `shared/trust-policy.js`

### 历史记录与持久化

优先查看：

- `db.js`
- `sidebar.js`
- `shared/run-utils.js`

### TypeScript 契约

优先查看：

- `tsconfig.json`
- `types/messages.ts`
- `types/history.ts`
- `types/settings.ts`
- `types/diagnostics.ts`

原则：类型反映当前字段和消息 action，不借机重命名或改变运行时代码；迁移到构建链前，类型文件不进入 Manifest 或 HTML 脚本加载列表。

## 文档维护规则

当前文档分成“稳定说明”和“规划草案”两类。

稳定说明：

- `README.md`：项目概览、快速开始、验证入口
- `docs/README.md`：文档索引与文档分工
- `docs/USER_GUIDE.md`：用户视角的功能和行为
- `docs/TECHNICAL_ARCHITECTURE.md`：代码边界、数据模型、存储和运行链路
- `docs/TESTING.md`：测试分层、覆盖口径、命令和新增功能要求
- `docs/DEVELOPER_GUIDE.md`：开发流程、验证和维护约定

规划草案：

- `docs/UPGRADE_DESIGN.md`：Pinboard 启发下的后续升级方向与低风险重构路线
- `docs/TS_REACT_MIGRATION.md`：TypeScript、构建链和 React 的分阶段迁移方案

出现以下变化时，需要同步更新：

- 用户操作流程变化：更新 `README.md` 和 `docs/USER_GUIDE.md`
- 架构边界、消息链路、数据模型变化：更新 `docs/TECHNICAL_ARCHITECTURE.md`
- 测试命令、覆盖策略、验证入口变化：更新 `docs/TESTING.md` 和 `docs/DEVELOPER_GUIDE.md`
- 文档入口或文档分工变化：更新 `README.md` 和 `docs/README.md`
- 产品升级方向、行为等价重构路线变化：更新 `docs/UPGRADE_DESIGN.md`
- TypeScript、构建链、框架迁移变化：更新 `docs/TS_REACT_MIGRATION.md`
- 贡献约定变化：更新 `CONTRIBUTING.md`

## 当前建议保持的工程边界

- 当前运行产物继续保持无构建、纯脚本结构；TypeScript、构建链和 React 迁移必须按 `docs/TS_REACT_MIGRATION.md` 分阶段推进。
- TypeScript 契约当前只做 `tsc --noEmit` 检查，不能把 `types/` 当作运行时代码加载。
- 共享逻辑优先放在 `shared/`，不要把同类判断复制到 popup、sidebar、reader 三处。
- provider-specific 逻辑继续收敛在 `adapters/`，不要把 transport 和 provider 分支堆回 `background.js`。
- 入口状态继续收敛在 `background/entrypoints.js`，不要把 context menu / command listener 重新散回 `background.js`。
- 后台运行状态继续收敛在 `background/run-state.js`，不要把 active run / port run Map 重新散回 `background.js`。
- 阅读页临时会话继续收敛在 `background/reader-sessions.js`，不要把 reader session 过期清理散回 `background.js`。
- 运行时消息新增或改名时，同步检查 `types/messages.ts`、`tests/static-contracts.test.js` 和 `docs/TECHNICAL_ARCHITECTURE.md`。
- 与落库和隐私相关的改动，务必同时检查 `db.js`、`shared/trust-policy.js` 和用户文档。
- 如果某条用户主路径能稳定地在浏览器里复现，优先补 Playwright，而不是只留下手工说明。
