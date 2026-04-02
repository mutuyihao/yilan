# 开发者指南

Last updated: 2026-03-29

这份文档覆盖当前仓库最需要的开发信息：如何理解代码、如何验证修改，以及修改后该同步更新哪些文档。

## 建议阅读顺序

1. [README.md](../README.md)
2. [用户文档](USER_GUIDE.md)
3. [技术架构](TECHNICAL_ARCHITECTURE.md)
4. [协作与贡献](../CONTRIBUTING.md)

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

## 最小验证命令

### 语法检查

```powershell
node --check background.js
node --check content.js
node --check popup.js
node --check sidebar.js
node --check reader.js
node --check db.js
node --check shared/article-utils.js
node --check shared/page-strategy.js
node --check shared/trust-policy.js
node --check adapters/openai-adapter.js
node --check adapters/anthropic-adapter.js
node --check adapters/registry.js
```

### 测试

```powershell
node tests/run-tests.js
```

如果 PowerShell 拦截 `npm.ps1`，直接运行上面的 `node` 命令即可。

## 手工回归清单

对用户可见改动，至少覆盖受影响路径。

### 设置页

- 标签切换正常。
- 文本输入会自动保存，离开输入框也会保存。
- 复选框和下拉框立即保存。
- 主题切换能同步到 popup、侧栏和阅读页。
- 测试连接能使用刚保存的最新配置。

### 侧栏主流程

- 右键菜单和 `Alt + S` 能打开侧栏。
- `入口自动生成摘要` 开关行为正确。
- `入口默认简短总结` 生效。
- 主摘要能生成。
- 长文能触发分段与汇总。
- 取消能中断当前运行。

### 历史与收藏

- 历史记录可写入。
- 搜索、收藏、删除可用。
- 按站点聚合筛选可用。
- 不写入历史的结果不会进入历史，也不能收藏。

### 阅读与导出

- “阅读”按钮能打开独立阅读页。
- 阅读页能显示当前摘要、原文链接和复制按钮。
- Markdown 导出可用。
- 长截图分享卡可生成，且带来源链接。

### 隐私与控制

- 无痕模式下结果不会写入历史。
- 关闭默认写入历史后，结果只保留在当前侧栏。
- 关闭分享卡后，分享按钮被禁用或拦截。
- 侧栏显示的可信状态和真实行为一致。

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

仓库现在只保留四类核心文档：

- `README.md`：项目概览、快速开始、目录和验证入口
- `docs/USER_GUIDE.md`：用户视角的功能和行为
- `docs/TECHNICAL_ARCHITECTURE.md`：代码边界、数据模型、存储和运行链路
- `docs/DEVELOPER_GUIDE.md`：开发流程、验证和维护约定

出现以下变化时，需要同步更新：

- 用户操作流程变化：更新 `README.md` 和 `docs/USER_GUIDE.md`
- 架构边界、消息链路、数据模型变化：更新 `docs/TECHNICAL_ARCHITECTURE.md`
- 开发流程、验证命令、回归要求变化：更新 `docs/DEVELOPER_GUIDE.md`
- 贡献约定变化：更新 `CONTRIBUTING.md`

## 当前建议保持的工程边界

- 继续保持无构建、纯脚本结构，除非复杂度明显超过当前形态。
- 共享逻辑优先放在 `shared/`，不要把同类判断复制到 popup、sidebar、reader 三处。
- 与落库和隐私相关的改动，务必同时检查 `db.js`、`shared/trust-policy.js` 和用户文档。
- 对文案和 UI 的改动，也要验证历史、导出、分享和阅读页是否仍然一致。
