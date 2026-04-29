# 开发者指南

Last updated: 2026-04-15

这份文档面向在当前仓库里改代码的人，重点说明三件事：先看哪些文档、修改后怎么验证、哪些事实应该写回哪份文档。

## 建议阅读顺序

1. [文档索引](README.md)
2. [项目概览](../README.md)
3. [测试体系](TESTING.md)
4. [技术架构](TECHNICAL_ARCHITECTURE.md)
5. [升级设计（draft）](UPGRADE_DESIGN.md)
6. [TypeScript + Preact 迁移设计（draft）](TS_PREACT_MIGRATION.md)
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

`npm test` 会跑 Node 层测试，并附带一方 JavaScript 文件的语法检查、功能覆盖矩阵和静态契约检查。

### 2. 浏览器主链路回归

```powershell
npm run test:e2e
```

首次运行 Playwright 前，通常需要先安装 Chromium：

```powershell
npm run playwright:install
```

### 3. PowerShell 兼容写法

如果 Windows PowerShell 拦截 `npm.ps1`，可改用：

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run playwright:install
```

如果只需要 Node 层入口，也可以直接运行：

```powershell
node tests/run-tests.js
```

## 验证分工

- `npm test`：纯逻辑、存储层、静态契约、功能覆盖矩阵门禁。
- `npm run test:e2e`：真实 Chromium 中的 popup、content script、background service worker、sidebar iframe、reader 页面与 mocked AI 链路。
- 手工回归：主题视觉、浏览器受限页面、稀有 provider / endpoint 组合、快捷键设置页跳转等不适合全部固化成 E2E 的路径。

## 手工回归清单

对用户可见改动，除了自动化之外，至少补受影响路径的人工确认。当前 Playwright 已覆盖 popup 自动保存与连接测试、主摘要生成、长文分段、历史复用、隐私/分享策略、取消生成、导出下载和阅读页打开，但以下场景仍建议手工确认：

### 设置页

- 标签切换正常。
- 主题切换能同步到 popup、侧栏和阅读页。
- “检查入口”和“快捷键设置”仍能给出正确状态或跳转。
- 厂商 preset、Provider、Endpoint Mode 的非常见组合仍能得到合理表单状态。

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
- `adapters/openai-adapter.js`
- `adapters/anthropic-adapter.js`
- `adapters/registry.js`
- `background.js`

原则：provider-specific 逻辑优先放进 `adapters/`，不要把兼容分支堆回后台主流程。

### 侧栏 UI 与阅读体验

优先查看：

- `sidebar.html`
- `sidebar.js`
- `style.css`
- `reader.html`
- `reader.js`

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
- `docs/TS_PREACT_MIGRATION.md`：TypeScript、构建链和 Preact 的分阶段迁移方案

出现以下变化时，需要同步更新：

- 用户操作流程变化：更新 `README.md` 和 `docs/USER_GUIDE.md`
- 架构边界、消息链路、数据模型变化：更新 `docs/TECHNICAL_ARCHITECTURE.md`
- 测试命令、覆盖策略、验证入口变化：更新 `docs/TESTING.md` 和 `docs/DEVELOPER_GUIDE.md`
- 文档入口或文档分工变化：更新 `README.md` 和 `docs/README.md`
- 产品升级方向、行为等价重构路线变化：更新 `docs/UPGRADE_DESIGN.md`
- TypeScript、构建链、框架迁移变化：更新 `docs/TS_PREACT_MIGRATION.md`
- 贡献约定变化：更新 `CONTRIBUTING.md`

## 当前建议保持的工程边界

- 当前运行产物继续保持无构建、纯脚本结构；TypeScript、构建链和 Preact 迁移必须按 `docs/TS_PREACT_MIGRATION.md` 分阶段推进。
- 共享逻辑优先放在 `shared/`，不要把同类判断复制到 popup、sidebar、reader 三处。
- provider-specific 逻辑继续收敛在 `adapters/`，不要把 transport 和 provider 分支堆回 `background.js`。
- 与落库和隐私相关的改动，务必同时检查 `db.js`、`shared/trust-policy.js` 和用户文档。
- 如果某条用户主路径能稳定地在浏览器里复现，优先补 Playwright，而不是只留下手工说明。
