# 文档索引

Last updated: 2026-05-05

文档按“稳定事实”和“规划草案”分层。稳定事实描述当前已经落地的行为；规划草案只描述后续方向和迁移方案，不能当作当前功能说明。

## 稳定事实

- [项目概览（英文默认）](../README.md)：产品定位、快速开始、目录结构和验证入口。
- [项目概览（中文）](../README.zh-CN.md)：中文版本的项目概览。
- [用户文档](USER_GUIDE.md)：用户可见功能、设置项和使用路径。
- [技术架构](TECHNICAL_ARCHITECTURE.md)：当前运行链路、Mermaid 架构图、模块依赖图、启动顺序、数据模型和稳定约束。
- [测试体系](TESTING.md)：Node / Playwright 分层、覆盖口径、运行命令和新增功能要求。
- [开发者指南](DEVELOPER_GUIDE.md)：本地开发、回归流程和文档维护规则。
- [1.0.0 发版清单](RELEASE_CHECKLIST.md)：双渠道发布门禁、打包命令、自动化与人工验收项。
- [Chrome Web Store 文案](STORE_LISTING.md)：商店标题、描述、权限解释和隐私问答草案。
- [隐私政策](../PRIVACY_POLICY.md)：BYOK 数据流、权限解释、本地历史和 API Key 存储边界。
- [设计系统](../DESIGN_SYSTEM.md)：主题 token、四套色彩方案、popup / 侧栏 / 阅读页 / 官网的视觉约束。
- [更新日志](../CHANGELOG.md)：正式版本的用户可见改动。
- [第三方声明](../THIRD_PARTY_NOTICES.md)：随仓库分发的第三方库、上游和许可证说明。

## 规划草案

- [升级设计](UPGRADE_DESIGN.md)：Pinboard 启发下的产品方向和行为等价重构路线。
- [TS + React 迁移评估与执行计划](TS_REACT_MIGRATION.md)：用 TypeScript、构建链和 React 降低技术债的分阶段方案。

## 维护规则

- 稳定事实只保留一份主说明，其他文档尽量链接，不重复扩写。
- 规划性内容必须标注 `Status: draft`。
- 用户操作变化更新 `README.md`、`README.zh-CN.md` 和 `docs/USER_GUIDE.md`。
- 架构、消息链路、数据模型变化更新 `docs/TECHNICAL_ARCHITECTURE.md`。
- 测试命令或覆盖策略变化更新 `docs/TESTING.md` 和 `docs/DEVELOPER_GUIDE.md`。
- 主题、色彩、排版或页面外观约束变化更新 `DESIGN_SYSTEM.md`。
- 隐私、权限、数据发送或本地存储边界变化更新 `PRIVACY_POLICY.md`、`docs/STORE_LISTING.md` 和用户文档。
- 发布包内容或发版门禁变化更新 `docs/RELEASE_CHECKLIST.md` 和根 README。
- 重构路线、技术债优先级或工程迁移方案变化更新对应 draft 文档。
