# 技术架构

Last updated: 2026-04-03

这份文档只描述当前仓库里已经落地并仍然有效的架构边界，不再保留旧规划文档里的重复描述。

## 运行时总览

当前主链路如下：

1. `popup.html / popup.js` 负责设置页 UI、标签切换、自动保存、连接测试和入口状态检查。
2. `content.js` 在网页中抽取正文和元信息，并注入侧栏容器。
3. `shared/article-utils.js` 把抽取结果标准化为文章快照，并根据长度决定是否分段。
4. `shared/page-strategy.js` 基于页面类型给出页面策略和推荐摘要模式。
5. `sidebar.js` 负责主摘要、二次生成、历史、收藏、分享、阅读页入口和诊断展示。
6. `background.js` 通过 `adapters/` 执行请求，统一处理流式、取消、重试、超时、错误和入口状态维护。
7. `db.js` 把结构化结果保存到 IndexedDB，并提供搜索、收藏、删除和站点聚合能力。
8. `reader.html / reader.js` 从临时阅读会话中恢复当前摘要，在新标签页提供专注阅读体验。

## 主要模块

### `manifest.json`

定义扩展形态和权限边界：

- `manifest_version: 3`
- service worker: `background.js`
- popup: `popup.html`
- content script: `content.js` 及其依赖
- 权限：`contextMenus`、`storage`、`activeTab`、`scripting`、`clipboardWrite`
- `host_permissions: <all_urls>`

### `popup.html / popup.js`

职责：

- 渲染设置页三个标签：`连接`、`偏好`、`入口`
- 自动保存设置
- 测试连接
- 打开当前页历史
- 配置入口是否优先复用本页历史摘要
- 检查右键菜单 / 快捷键状态
- 打开浏览器快捷键设置页

自动保存策略：

- 文本输入走 debounce + `blur` 立即保存
- 复选框和下拉框走 immediate save
- `visibilitychange` 和 `pagehide` 时 flush 未完成改动

### `content.js`

职责：

- 从当前网页读取 DOM、meta 信息和 Readability 结果
- 构建文章快照输入
- 注入侧栏容器和资源
- 在入口触发时把数据发给侧栏

说明：

- `content.js` 使用 `libs/readability.js` 这个 vendored 的外部库做正文抽取。
- `readability.js` 属于第三方依赖，不是项目自研模块。

### `sidebar.html / sidebar.js / style.css`

职责：

- 渲染主要工作台
- 展示来源信息和可信与控制状态
- 处理主摘要和二次生成
- 在入口触发时优先复用当前页面的历史摘要，并保留当前页上下文用于重新生成
- 维护历史 / 收藏面板
- 导出 Markdown
- 生成长截图分享卡
- 打开新标签页阅读器
- 展示运行诊断

### `reader.html / reader.js`

职责：

- 从 `chrome.storage.local` 读取阅读会话快照
- 必要时回查 IndexedDB 记录
- 展示独立阅读布局
- 提供“打开原文”和“复制 Markdown”操作

阅读页不是默认主工作区，而是侧栏之外的补充阅读路径。

### `background.js`

职责：

- provider 适配器解析与请求执行
- 流式输出和取消控制
- 统一错误归一化
- 连接测试
- 维护右键菜单和快捷键状态
- 打开快捷键设置页
- 创建独立阅读页会话并打开 `reader.html`

主要消息入口：

- `testConnection`
- `runPrompt`
- `cancelRun`
- `triggerHistory`
- `getEntrypointStatus`
- `openShortcutSettings`
- `openReaderTab`

### `db.js`

职责：

- 打开 IndexedDB
- 维护 `summaryRecords` store
- 兼容旧 `history` store 迁移
- 记录标准化
- 按 articleId / URL 匹配当前页面可复用的历史记录
- 搜索、收藏、删除、站点聚合

当前关键状态：

- `DB_VERSION = 2`
- 主 store：`summaryRecords`
- 旧 store：`history`

### `shared/`

按“工具边界清晰、复用逻辑集中”的方式组织：

- `domain.js`：URL 归一化、ID / hash、站点识别
- `strings.js`：摘要模式、页面类型标签、状态文案
- `page-strategy.js`：页面类型到策略和推荐模式的映射
- `article-utils.js`：文章快照构建、分段、prompt 生成
- `trust-policy.js`：无痕和默认策略归一化
- `provider-presets.js`：厂商 preset、Provider / Endpoint Mode 默认值
- `theme.js`：popup、侧栏、阅读页的主题同步
- `errors.js`：统一错误模型
- `abort-utils.js`：取消控制工具
- `run-utils.js`：运行终态、取消说明、诊断摘要

### `adapters/`

provider-specific 逻辑集中在这里，而不是散落在 `background.js`：

- `openai-adapter.js`
- `anthropic-adapter.js`
- `registry.js`

当前支持的接口族：

- OpenAI Compatible `responses`
- OpenAI Compatible `chat_completions`
- OpenAI Compatible `legacy_completions`
- Anthropic `messages`

## 数据模型

### 1. 文章快照

文章快照是一次页面抽取后的标准化结果，主要包含：

- 来源：`sourceUrl`、`normalizedUrl`、`sourceHost`、`siteName`
- 元信息：`title`、`author`、`publishedAt`、`language`
- 内容：`rawText`、`cleanText`、`content`、`contentLength`
- 页面理解：`sourceType`、`sourceStrategy`、`preferredSummaryMode`
- 长文信息：`chunkingStrategy`、`chunkCount`、`chunks`
- 可信边界：`allowHistory`、`allowShare`
- 质量信号：`warnings`、`qualityScore`、`diagnostics`

### 2. 运行时适配器快照

每次请求都会快照当前适配器配置，至少包括：

- `provider`
- `adapterId`
- `endpointMode`
- `model`
- `baseUrl`

这些字段会进入结果记录，避免历史因后续设置变化而失真。

### 3. 总结记录

历史记录是结构化对象，而不是简单字符串列表。当前记录至少包含：

- 身份：`recordId`、`articleId`、`runId`
- 来源快照：URL、标题、站点、文章快照
- 请求快照：摘要模式、目标语言、prompt 配置
- 模型快照：provider、adapter、endpoint、model
- 状态：`status`、`retryCount`、`durationMs`、错误信息、诊断
- 输出：`summaryMarkdown`、`summaryPlainText`
- 组织信息：`favorite`、`dedupeKey`
- 可信边界：`privacyMode`、`allowHistory`、`allowShare`

### 4. 阅读会话

独立阅读页使用临时阅读会话，而不是直接依赖侧栏状态：

- 存在 `chrome.storage.local`
- key 前缀：`readerSession:`
- 默认保留 24 小时
- 优先读取侧栏传入的快照
- 如果记录允许落库，再尝试回查 IndexedDB 获得最新内容

这样即使当前结果未写入历史，也能打开独立阅读页。

## 存储边界

### `chrome.storage.sync`

保存用户设置，例如：

- API Key
- 厂商预设、Provider、Endpoint Mode
- Base URL、模型名称、额外系统要求
- 自动翻译、默认输出语言
- 主题偏好
- 无痕模式、默认写入历史、默认允许分享
- 入口自动生成、入口默认简短总结、入口优先显示本页历史摘要

### `chrome.storage.local`

保存本地运行时状态：

- 右键菜单 / 快捷键状态
- 最近触发信息
- 阅读页临时会话

### IndexedDB

保存历史记录：

- 数据库：`AISummaryDB`
- 版本：`2`
- store：`summaryRecords`
- 保留旧 `history` store 用于迁移兼容

## 稳定边界

当前有几个边界不应再被打散：

- provider 逻辑继续收敛在 `adapters/`，不要回到 `background.js` 里堆分支。
- 可信策略继续收敛在 `shared/trust-policy.js`，不要在 UI 层各自拼判断。
- 历史记录始终以结构化对象保存，不退回到简单字符串列表。
- 阅读页继续作为侧栏之外的补充阅读能力，而不是替代侧栏主工作流。
- 在没有明确收益之前，保持当前无构建、纯脚本的轻量结构。


