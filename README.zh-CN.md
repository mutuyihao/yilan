# 一览

Last updated: 2026-05-05

语言：中文 | [English](README.md)

官网：<https://yilan.app>
GitHub：<https://github.com/mutuyihao/yilan>
社区讨论：<https://discord.gg/MWWDwXZ2TV>

一览是一个基于 Manifest V3 的 Chromium 扩展，用来在浏览器里完成“抽取网页 -> 生成摘要 -> 继续加工 -> 本地沉淀 -> 专注阅读”这一整条链路。

当前版本已经不是单一的摘要工具，而是一个本地优先的网页阅读工作台：

- 自动抽取网页正文、标题、作者、发布时间和站点信息。
- 识别页面类型，并按页面类型推荐摘要策略。
- 支持 `简短总结`、`标准总结`、`详细分析`、`关键要点` 四种主摘要模式。
- 支持 `行动项`、`术语表`、`问答卡片` 三种二次生成模式。
- 在侧栏中查看来源信息、可信与控制状态、历史与收藏、基础诊断。
- 入口可优先复用当前页面的历史摘要，命中后直接展示旧结果，并保留“重新生成”更新当前页。
- 在同一页面的 SPA 路由切换中，侧栏会刷新页面上下文，但默认不会自动发起新的模型请求。
- 支持把当前摘要打开到独立的新标签页阅读器。
- 支持复制当前摘要、Markdown 导出和带来源链接的长截图分享卡。
- 设置页支持厂商预设、显式或自动 Endpoint Mode、OpenAI 兼容接口的模型列表刷新、明暗模式、四套色彩方案、入口状态检查，并且默认自动保存。
- 当前测试基线已经分成 `Node 功能矩阵 + 静态契约` 与 `Playwright 浏览器主链路` 两层，用来给后续重构和技术债治理兜底。

## 当前边界

- 项目是 `本地优先 + BYOK` 形态，没有内建账号体系或云同步。
- 无痕模式只控制“是否写入本地历史”，不会阻止页面内容被发送到你配置的模型服务。
- 历史只保存在当前浏览器 profile 的 IndexedDB 中。
- 扩展目前面向 Chromium 浏览器，使用右键菜单和 `Alt + S` 作为主要入口。

## 快速开始

### 1. 加载扩展

1. 打开 Chrome、Edge 或其他 Chromium 浏览器。
2. 进入扩展管理页。
3. 打开“开发者模式”。
4. 选择“加载已解压的扩展程序”。
5. 选择当前项目目录。

### 2. 配置模型

1. 点击扩展图标打开设置页。
2.（可选）创建 `配置方案`，保存多套连接配置并快速切换。
3. 在 `连接` 标签中选择厂商预设、Provider 和 Endpoint Mode。
4. 填写 `API Key`，按需覆盖 `Base URL` 和 `模型名称`。
5. 等待自动保存完成后点击“测试连接”。

说明：

- 设置页默认自动保存，不需要先手动点击保存。
- 文本输入项会在停顿后保存，`blur` 时也会立即保存。
- 下拉框和开关会立即保存。
- `Base URL` 既可以填根地址（例如 `https://api.openai.com/v1`），也可以直接填完整 endpoint；设置页会显示请求预览。
- `Endpoint Mode` 可以显式指定，也可以在 OpenAI 兼容自定义网关里使用“自动判断”。连接测试可能缓存可用 endpoint mode，并在网关错误足够明确时自动补齐或去除 `/v1`。
- 可在设置页为 OpenAI 兼容接口刷新模型列表（需要先填写 `API Key`）。Anthropic 兼容接口目前仍手动填写模型 ID。
- 内置厂商预设目前包含自定义兼容接口、OpenAI 官方、Anthropic 官方、DeepSeek、Gemini / Google、xAI / Grok、Qwen / 百炼、GLM / 智谱、MiniMax、Doubao / 火山方舟、Hunyuan / 腾讯混元。

### 3. 使用扩展

1. 打开任意网页。
2. 右键页面选择“用一览总结此页”，或按 `Alt + S`。
3. 侧栏打开后，会先按入口配置检查是否复用当前页面的历史摘要；命中时直接显示最近一次已完成结果，否则再自动开始生成，或只打开侧栏等待手动触发。
4. 在侧栏中查看摘要、继续生成行动项/术语表/问答卡片、管理历史与收藏。
5. 如需更舒服地阅读，点击顶部“阅读”按钮，在新标签页打开专注阅读页面。

## 开发与验证

最常用的验证入口：

```powershell
npm test
npm run typecheck
npm run test:e2e
```

首次运行浏览器端测试前，通常需要先安装 Chromium：

```powershell
npm run playwright:install
```

如果 Windows PowerShell 拦截 `npm.ps1`，可改用：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:e2e
npm.cmd run playwright:install
node tests/run-tests.js
```

更详细的覆盖口径、测试分层和新增功能要求见 [测试体系](docs/TESTING.md)。开发流程、手工回归和文档维护规则见 [开发者指南](docs/DEVELOPER_GUIDE.md)。

## 发版打包

1.0.0 正式版门禁：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:e2e
npm.cmd run package:release
```

`npm.cmd run package:release` 会在 `release/` 下生成只包含扩展运行文件的发布包，排除测试、Playwright 产物、私有目录、依赖目录和源码文档。发布前按 [1.0.0 发版清单](docs/RELEASE_CHECKLIST.md) 和 [Chrome Web Store 文案](docs/STORE_LISTING.md) 检查。

## 目录结构

```text
.
├─ adapters/                  # Provider 适配层
├─ docs/                      # 文档索引、用户/架构/测试/开发/规划草案
├─ e2e/                       # Playwright 浏览器端测试与扩展 harness
├─ icon/                      # 扩展图标
├─ landing-page/              # 官网静态页
├─ libs/                      # 第三方库
│  ├─ readability.js          # vendored 的 Readability，用于正文抽取
│  ├─ purify.min.js           # DOMPurify，用于净化 Markdown 渲染后的 HTML
│  ├─ marked.min.js           # Marked，用于 Markdown -> HTML 渲染
│  ├─ highlight.min.js        # highlight.js，用于代码块高亮
│  ├─ github-dark.min.css     # Markdown / 代码块高亮样式
│  └─ html2canvas.min.js      # 用于生成长截图分享卡
├─ shared/                    # 领域工具、页面策略、可信策略、主题、传输工具、厂商 preset
├─ tests/                     # Node 功能矩阵、单元测试、静态契约
├─ background.js              # 后台编排、连接检查、模型列表、入口状态、运行控制、reader 会话
├─ content.js                 # 页面抽取与侧栏注入
├─ db.js                      # IndexedDB 历史存储与迁移
├─ manifest.json              # 扩展清单
├─ playwright.config.js       # Playwright 配置
├─ popup.html / popup.js      # 设置页、标签切换、自动保存、入口检查
├─ reader.html / reader.js    # 独立阅读页
├─ sidebar.html / sidebar.js  # 侧栏工作流、历史、分享、诊断
└─ style.css                  # 侧栏样式
```

## 文档

- [文档索引](docs/README.md)
- [用户文档](docs/USER_GUIDE.md)
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [测试体系](docs/TESTING.md)
- [开发者指南](docs/DEVELOPER_GUIDE.md)
- [1.0.0 发版清单](docs/RELEASE_CHECKLIST.md)
- [Chrome Web Store 文案](docs/STORE_LISTING.md)
- [隐私政策](PRIVACY_POLICY.md)
- [设计系统](DESIGN_SYSTEM.md)
- [升级设计（draft）](docs/UPGRADE_DESIGN.md)
- [TypeScript + React 迁移设计（draft）](docs/TS_REACT_MIGRATION.md)
- [协作与贡献](CONTRIBUTING.md)
- [更新日志](CHANGELOG.md)

## 反馈

正式版问题请优先通过 GitHub Issues 反馈：<https://github.com/mutuyihao/yilan/issues>。社区讨论入口：<https://discord.gg/MWWDwXZ2TV>。

## License

- 本项目原创代码与文档采用 `Apache-2.0`，详见 `LICENSE`。
- `libs/` 下随仓库分发的第三方库继续沿用各自上游许可证，详见 `THIRD_PARTY_NOTICES.md`。
- 如果第三方文件头部声明与本说明存在差异，以该第三方文件内保留的声明和其上游许可证文本为准。

## 致谢

本项目开发过程中获得了 [LINUX DO](https://linux.do/latest) 社区佬友的帮助，本产品会在社区发布，感谢社区的支持。
