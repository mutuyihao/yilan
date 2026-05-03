# 文档索引

Last updated: 2026-05-04

文档按“稳定事实”和“规划草案”分层。稳定事实描述当前已经落地的行为；规划草案只描述后续方向和迁移方案，不能当作当前功能说明。

## 稳定事实

- [项目概览（英文默认）](../README.md)：产品定位、快速开始、目录结构和验证入口。
- [项目概览（中文）](../README.zh-CN.md)：中文版本的项目概览。
- [用户文档](USER_GUIDE.md)：用户可见功能、设置项和使用路径。
- [技术架构](TECHNICAL_ARCHITECTURE.md)：当前运行链路、Mermaid 架构图、模块依赖图、启动顺序、数据模型和稳定约束。
- [测试体系](TESTING.md)：Node / Playwright 分层、覆盖口径、运行命令和新增功能要求。
- [开发者指南](DEVELOPER_GUIDE.md)：本地开发、回归流程和文档维护规则。

## 规划草案

- [升级设计](UPGRADE_DESIGN.md)：Pinboard 启发下的产品方向和行为等价重构路线。
- [TS + React 迁移评估与执行计划](TS_REACT_MIGRATION.md)：用 TS 和 React 降低技术债的分阶段方案。

## 维护规则

- 稳定事实只保留一份主说明，其他文档尽量链接，不重复扩写。
- 规划性内容必须标注 `Status: draft`。
- 用户操作变化更新 `README.md`、`README.zh-CN.md` 和 `docs/USER_GUIDE.md`。
- 架构、消息链路、数据模型变化更新 `docs/TECHNICAL_ARCHITECTURE.md`。
- 测试命令或覆盖策略变化更新 `docs/TESTING.md` 和 `docs/DEVELOPER_GUIDE.md`。
- 重构路线、技术债优先级或工程迁移方案变化更新对应 draft 文档。
