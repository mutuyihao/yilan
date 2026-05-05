# 协作与贡献指南

Last updated: 2026-05-05

欢迎提交 issue 和 PR。这个项目希望保持“轻量、清晰、可维护”的演进方式：功能可以继续增加，但边界不能越来越乱。

## 建议先读

1. [README.md](README.md)
2. [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
3. [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md)
4. [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)

## 贡献范围

欢迎的改动：

- Bug 修复
- 抽取质量和摘要质量优化
- 页面策略、Prompt 和模型适配增强
- 侧栏、阅读页、设置页的可用性改进
- 测试、文档和开发体验优化

请尽量避免：

- 无明确收益的重型工程化改造
- 把 provider-specific 逻辑重新堆回 `background.js`
- 只修 UI，不检查对应的历史、导出、阅读页或隐私行为

## 代码组织约定

- Provider 兼容逻辑优先放在 `adapters/`
- 通用规则优先放在 `shared/`
- 页面抽取与页面理解优先放在 `content.js`、`shared/article-utils.js`、`shared/page-strategy.js`
- 历史、导出、隐私和运行诊断属于完整链路，改动时要一起检查
- 用户可见行为变化了，文档要同轮更新

## 不要提交的内容

公开仓库默认不应提交以下内容：

- `.claude/`
- `node_modules/`
- 打包产物，如 `*.zip`、`*.crx`
- 本地编辑器和系统垃圾文件

## 开发前建议

提交改动前，先确认这几个问题：

1. 这次改动主要影响哪条链路：抽取、摘要生成、侧栏、阅读页、设置页，还是持久化？
2. 这是核心边界变化，还是纯展示层变化？
3. 是否会影响历史兼容性、隐私边界、导出结果或阅读体验？
4. 是否需要同步更新文档或测试？

## 最小验证

至少执行：

```powershell
npm test
npm run typecheck
```

如果 Windows PowerShell 拦截 `npm.ps1`，可改用 `npm.cmd test` 和 `npm.cmd run typecheck`。如果改动影响注入逻辑、侧栏、阅读页或页面路由，记得在扩展管理页 `Reload` 扩展，并刷新目标网页重新验证；能稳定自动化的主路径优先补 Playwright。

## 手工回归建议

对用户可见改动，至少覆盖受影响路径。

- 设置页：自动保存、主题切换、连接测试、Endpoint Mode 自动判断、模型列表刷新
- 侧栏：打开、自动生成、取消、模式切换、二次生成
- 长文：分段与汇总
- 历史与收藏：写入、搜索、筛选、删除、收藏
- 阅读页：打开、复制、原文链接
- 导出与分享：Markdown 导出、长截图分享卡
- 隐私与控制：无痕模式、默认历史、默认分享
- SPA 页面：同 tab 切页面后，侧栏是否跟随当前页面

## 文档同步规则

出现以下变化时，需要同步更新：

- 用户操作流程变化：更新 `README.md` 和 `docs/USER_GUIDE.md`
- 架构、消息链路、数据模型变化：更新 `docs/TECHNICAL_ARCHITECTURE.md`
- 验证方式和开发流程变化：更新 `docs/DEVELOPER_GUIDE.md`
- 贡献流程或公开仓库边界变化：更新 `CONTRIBUTING.md`

## PR 自检清单

提交 PR 前，建议至少确认：

- 改动范围聚焦，没有顺手混入无关重构
- 不包含本地私有资料、工具配置或打包产物
- 相关文档已更新
- 最小验证已跑通
- 如果改动影响用户可见行为，PR 描述里写清楚变化点和验证方式

## 沟通方式

如果你准备做较大的改动，建议先开 issue 或 draft PR，对齐方向后再展开实现。这样更容易避免重复工作，也更容易把架构边界守住。
