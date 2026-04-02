# 一览

Last updated: 2026-04-02

官网：<https://yilan.app>
GitHub：<https://github.com/mutuyihao/yilan>
社区讨论：<https://discord.gg/MWWDwXZ2TV>

一览是一个基于 Manifest V3 的 Chromium 扩展，用来在浏览器里完成“抽取网页 -> 生成摘要 -> 继续加工 -> 本地沉淀 -> 专注阅读”这一整条链路。

项目现在已经不是单一的摘要工具，而是一个轻量阅读工作台：

- 自动抽取网页正文、标题、作者、发布时间和站点信息。
- 识别页面类型，并按页面类型推荐摘要策略。
- 支持 `简短总结`、`标准总结`、`详细分析`、`关键要点` 四种主摘要模式。
- 支持 `行动项`、`术语表`、`问答卡片` 三种二次生成模式。
- 在侧栏中查看来源信息、可信与控制状态、历史与收藏、基础诊断。
- 支持把当前摘要打开到独立的新标签页阅读器。
- 支持 Markdown 导出和带来源链接的长截图分享卡。
- 设置页支持厂商预设、显式 endpoint mode、主题偏好、入口状态检查，并且默认自动保存。

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
2. 在 `连接` 标签中选择厂商预设、Provider 和 Endpoint Mode。
3. 填写 `API Key`，按需覆盖 `Base URL` 和 `模型名称`。
4. 等待自动保存完成后点击“测试连接”。

说明：

- 设置页现在默认自动保存，不需要先手动点击保存。
- 文本输入项会在停顿后保存，`blur` 时也会立即保存。
- 下拉框和开关会立即保存。
- 内置厂商预设目前包含 OpenAI、Anthropic、DeepSeek、Gemini、xAI、Qwen、GLM、MiniMax、Doubao、Hunyuan。

### 3. 使用扩展

1. 打开任意网页。
2. 右键页面选择“用一览总结此页”，或按 `Alt + S`。
3. 侧栏打开后，按当前入口配置自动开始生成，或只打开侧栏等待手动触发。
4. 在侧栏中查看摘要、继续生成行动项/术语表/问答卡片、管理历史与收藏。
5. 如需更舒服地阅读，点击顶部“阅读”按钮，在新标签页打开专注阅读页面。

## 存储与权限

### `chrome.storage.sync`

用于保存用户设置，例如：

- API Key
- 厂商预设、Provider、Endpoint Mode
- Base URL、模型名称、额外系统要求
- 自动翻译、默认输出语言
- 主题偏好
- 无痕模式、默认写入历史、默认允许分享
- 入口自动生成、入口默认简短总结

### `chrome.storage.local`

用于保存运行时本地状态：

- 右键菜单 / 快捷键状态检查结果
- 独立阅读页的临时会话快照

### IndexedDB

用于保存历史记录：

- 数据库版本：`DB_VERSION = 2`
- 主 store：`summaryRecords`

## 目录结构

```text
.
├─ adapters/                  # Provider 适配层
├─ docs/                      # 精简后的核心文档
├─ icon/                      # 扩展图标
├─ libs/                      # 第三方库
│  └─ readability.js          # vendored 的 Readability 外部库
├─ shared/                    # 领域工具、页面策略、可信策略、主题、厂商 preset
├─ tests/                     # 最小测试集
├─ background.js              # 后台编排、入口状态、运行控制、reader 会话
├─ content.js                 # 页面抽取与侧栏注入
├─ db.js                      # IndexedDB 历史存储与迁移
├─ popup.html / popup.js      # 设置页、标签切换、自动保存、入口检查
├─ sidebar.html / sidebar.js  # 侧栏工作流、历史、分享、诊断
├─ reader.html / reader.js    # 独立阅读页
├─ style.css                  # 侧栏样式
└─ manifest.json              # 扩展清单
```

## 开发与验证

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

## 文档

- [用户文档](docs/USER_GUIDE.md)
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [开发者指南](docs/DEVELOPER_GUIDE.md)
- [协作与贡献](CONTRIBUTING.md)
