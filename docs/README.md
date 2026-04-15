# 文档索引

Last updated: 2026-04-15

这套文档现在分成“入口文档”和“专题文档”两层，目标是减少重复维护，让产品说明、测试说明和重构规划各自有明确归属。

## 先看哪一篇

- [项目概览](../README.md)：快速了解产品定位、安装方式、主要目录和验证入口。
- [用户文档](USER_GUIDE.md)：确认当前用户可见功能、设置项和使用路径。
- [技术架构](TECHNICAL_ARCHITECTURE.md)：查看运行链路、模块边界、数据模型和稳定约束。
- [测试体系](TESTING.md)：查看 Node / Playwright 分层、覆盖口径、运行命令和新增功能要求。
- [开发者指南](DEVELOPER_GUIDE.md)：查看开发流程、回归要求和文档维护规则。
- [升级设计（draft）](UPGRADE_DESIGN.md)：查看 Pinboard 启发下的产品升级方向与低风险重构路线。

## 文档分工

- `README.md`：项目概览、快速开始、验证入口。
- `docs/README.md`：文档导航和文档分工。
- `docs/USER_GUIDE.md`：用户视角的真实功能边界。
- `docs/TECHNICAL_ARCHITECTURE.md`：运行时结构、数据模型、存储边界、验证边界。
- `docs/TESTING.md`：测试命令、覆盖定义、自动化边界。
- `docs/DEVELOPER_GUIDE.md`：本地开发、回归策略、维护规则。
- `docs/UPGRADE_DESIGN.md`：未来方向和重构计划，当前状态是 `draft`。

## 更新规则

- 用户操作流程变化：更新 `README.md` 和 `docs/USER_GUIDE.md`
- 架构边界、消息链路、数据模型变化：更新 `docs/TECHNICAL_ARCHITECTURE.md`
- 测试命令、覆盖策略、验证入口变化：更新 `docs/TESTING.md` 和 `docs/DEVELOPER_GUIDE.md`
- 文档入口或文档分工变化：更新 `README.md` 和 `docs/README.md`
- 重构路线、阶段计划、技术债优先级变化：更新 `docs/UPGRADE_DESIGN.md`
- 贡献约定变化：更新 `CONTRIBUTING.md`

## 写作约定

- 稳定事实只保留一份主说明，其他文档尽量链接，不重复扩写。
- 规划性内容必须显式标注 `draft` 或其他状态，避免与已落地行为混淆。
- 命令、目录和文件名应保持与仓库实际结构一致，可直接映射到代码。
