# 升级设计：个人网页记忆库与低风险重构

Last updated: 2026-04-29

Status: draft

这份文档用于承接两件事：

- 记录 Pinboard 对一览后续产品方向的启发。
- 定义不破坏现有功能运行的代码质量提升与技术债治理方案。

TypeScript、构建链和 Preact 的专项迁移计划不在本文展开，见 [TypeScript + Preact 迁移设计](TS_PREACT_MIGRATION.md)。

当前阶段的原则是先减负、稳住边界，再扩展能力。除非另有明确说明，本文里的重构都应保持行为等价，不改变用户可见功能。

## 1. 产品升级方向

Pinboard 的核心启发不是复刻书签站，而是把“一览”从“网页 AI 总结器”推进为“本地优先、可检索、可迁移的个人网页记忆库”。

### 1.1 可吸收的产品骨架

- 低摩擦保存：用户不一定每次都要立即总结，应该支持“只保存”“稍后读”“保存并总结”。
- 长期找回：历史不只是摘要列表，而是可按标题、站点、标签、备注、摘要、原文快照检索的资料库。
- 标签组织：优先做扁平标签、标签补全、标签交集筛选，不急着做复杂文件夹体系。
- 本地归档：保存可用的正文快照、摘要、元信息，后续支持全文搜索、死链提示、重新总结。
- 数据可带走：提供 JSON、Markdown、Netscape bookmarks HTML、Pinboard-compatible export 等导出路径。
- 隐私可信：继续坚持本地优先、BYOK、明确说明“发送给模型 / 写入本地 / 允许分享”的边界。
- 外部集成：在开放数据之后，再做 Pinboard、Obsidian、Readwise、Notion、Logseq 等导出或同步适配。

### 1.2 不应照搬的部分

- 不优先做公开社区、热榜、社交流。
- 不为了“云同步”过早引入账号系统。
- 不把产品重心从“用户自己的资料库”转成“内容发现平台”。
- 不为了产品升级过早引入服务端或账号体系；工程侧框架/构建链迁移必须走独立设计和独立验收。

## 2. 当前代码负重

当前代码能跑，但有几类负重会阻碍后续升级。

### 2.1 大文件职责过多

- `sidebar.js` 约 86KB，混合了状态、渲染、Markdown、历史、收藏、流式请求、导出、分享图、阅读器、主题切换等职责。
- `background.js` 约 31KB，混合了扩展入口、上下文菜单、快捷键、阅读会话、运行编排、取消控制、传输解析。
- `popup.js` 约 22KB，混合了设置表单、厂商 preset、自动保存、入口检查、连接测试。
- `style.css` 约 39KB，所有侧栏样式集中在一个文件里，后续新增资料库视图会继续膨胀。

### 2.2 重复逻辑治理进展

- `sidebar.js` 内重复的 `renderThemeToggleState`、`cycleThemePreference`、`updateFavoriteButton` 定义已收敛为单一定义，并由静态契约测试防回归。
- `formatDateTime`、`escapeHtml`、provider / mode / status / strategy / warning label、Markdown 纯文本预览和 bullet 提取已拆到 `shared/ui-format.js`、`shared/ui-labels.js`、`shared/summary-text.js`。
- 侧栏诊断、阅读快照、历史项和文章 meta/trust card 的展示数据已拆到 `shared/diagnostics-view.js`、`shared/reader-view.js`、`shared/history-view.js`、`shared/sidebar-meta-view.js`；历史面板运行逻辑已迁出到 `sidebar/history.js`；后续仍需继续压缩 `sidebar.js` 的生成、导出和 DOM 绑定职责。
- `sidebar.js` 与 `reader.js` 仍各自负责页面内 Markdown 渲染/净化和 DOM 写入，这部分暂不抽成共享渲染器，避免把页面差异和安全边界混在一个工具里。
- `background.js` 已复用 `shared/transport-utils.js` 的 SSE / raw body 解析逻辑，避免后台重复维护 transport 细节。

### 2.3 数据能力已埋点但未产品化

- `summaryRecords` 已有 `tags`、`notes`、`pinned` 字段，但侧栏没有完整的编辑和筛选体验。
- 搜索目前主要覆盖标题、站点、摘要、模式、provider、model、页面类型，没有充分利用用户标签、备注、原文快照。
- `articleSnapshot.cleanText` 已可作为本地全文索引输入，但当前还只是记录字段。

### 2.4 测试基线已建立，但还不够细

- 现在已经有 `tests/feature-matrix.js`、Node 单元测试、静态契约测试和 `tests/fake-indexeddb.js`，能锁住纯逻辑、存储和入口契约。
- 也已经有 Playwright 浏览器端主链路测试，可回归 popup 自动保存、连接测试、主摘要生成、长文分段、历史复用、隐私/分享策略、取消、下载和阅读页打开。
- 这套基线已经足够支撑“行为等价”的减负型重构。
- 但 provider 全排列、权限受限页面、视觉细节、极端大数据量场景仍然没有完全自动化覆盖。

## 3. 重构护栏

重构必须遵守以下边界：

- 每个阶段默认行为等价，不改变用户可见功能。
- 不把功能升级和结构重构混在同一次改动里。
- 不一次性重写 `sidebar.js`、`background.js` 或存储层。
- 不删除已有字段，不改变 IndexedDB keyPath，不随意提升 DB version。
- 不把构建工具、框架迁移和业务重构混在同一次改动里；相关迁移必须按专项设计推进。
- 先抽纯函数和重复逻辑，再拆运行编排，再拆 UI 模块。
- 每个重构切片都要能独立通过 `npm test`，必要时通过 `npm run test:e2e`。
- 任何涉及 `manifest.json`、`web_accessible_resources`、`importScripts`、IndexedDB migration 的改动都单独成批。

## 4. 分阶段方案

### Phase 0：保持安全基线可用

目标：让已经建立的 Node + Playwright 护栏持续可执行，并为后续每一步提供验收和回滚依据。

建议动作：

- 持续维护统一验证入口，任何测试分层变化都同步更新 `docs/TESTING.md` 和 `docs/DEVELOPER_GUIDE.md`。
- 对 Playwright 还未覆盖的路径维护手动烟测清单，例如主题、快捷键设置页、受限页面、稀有 provider 组合。
- 标记现有全局命名空间契约，例如 `AISummaryDomain`、`AISummaryArticleUtils`、`AISummaryRecordStore`、`AISummaryTransportUtils`。
- 记录每个入口页面的脚本加载顺序，防止拆文件后出现全局对象未加载。

验收：

- `npm test` 通过。
- `npm run test:e2e` 通过。
- 所有一方脚本 `node --check` 通过。
- 手动烟测清单至少覆盖未自动化路径一次。

### Phase 1：抽离重复的纯工具

目标：优先减少重复代码，不碰业务流程。

建议动作：

- 已新增 `shared/ui-format.js`，收敛 `escapeHtml` 和页面共用时间显示；`formatDuration` 继续归属 `shared/run-utils.js`，因为它服务于运行诊断语义。
- 已新增 `shared/ui-labels.js`，收敛 provider、摘要模式、记录状态、策略和 warning label，避免把显示文案继续复制到 popup、sidebar、reader。
- 已新增 `shared/summary-text.js`，收敛 Markdown 转纯文本、摘要预览截断和 bullet 提取；安全 HTML 渲染仍保留在页面层配合 DOMPurify / marked / highlight 处理。
- 已新增 `shared/diagnostics-view.js`、`shared/reader-view.js`、`shared/history-view.js`、`shared/sidebar-meta-view.js`，先抽纯视图模型，再考虑后续组件化。
- 已让 `sidebar.js`、`reader.js`、`popup.js` 改为调用共享工具，并删除 `sidebar.js` 内重复定义的主题和收藏按钮函数。

约束：

- 共享工具必须同时支持浏览器全局和 Node 测试环境。
- 新脚本加入 `sidebar.html`、`reader.html` 或 `popup.html` 时，必须确认加载顺序。
- 如果加入侧栏 iframe 可访问资源，必须同步检查 `manifest.json` 的 `web_accessible_resources`。

验收：

- 页面显示文案、时间格式、provider 显示不变。
- Markdown 渲染、复制、导出、阅读页显示不变。
- 现有测试通过，并为新增共享工具补最小单测。

### Phase 2：拆分侧栏职责

目标：把 `sidebar.js` 从单体脚本拆成可维护的垂直模块，同时不改变 UI 行为。

推荐拆分顺序：

- `sidebar/state.js`：集中状态对象、运行状态、当前文章、可见记录。
- `sidebar/render.js`：来源卡片、信任卡片、摘要渲染、错误态、进度态。
- `sidebar/history.js`：历史搜索、站点分组、收藏、删除、记录绑定。
- `sidebar/generation.js`：主摘要、分段摘要、二次生成、取消、流式连接。
- `sidebar/export.js`：复制、Markdown 导出、分享图。
- `sidebar/reader-session.js`：阅读页快照和打开逻辑。
- `sidebar/events.js`：DOM 事件绑定和初始化编排。

拆分策略：

- 先使用全局命名空间，例如 `window.YilanSidebar = window.YilanSidebar || {}`，避免一上来改成 ESM。
- 每次只迁移一组函数，迁移后让原 `sidebar.js` 调用新模块。
- 迁移完成后再删除旧函数，避免同时移动和改逻辑。
- 保持 `sidebar.html` 中脚本按依赖顺序加载。

验收：

- 历史面板、收藏按钮、重新生成、二次生成、取消、导出、分享、阅读页全部行为一致。
- 每个迁移 PR 的 diff 中不应出现产品文案和业务判断的大范围变化。

### Phase 3：收敛后台传输与运行编排

目标：减轻 `background.js`，让后台只负责扩展入口和运行编排，不重复维护 transport 细节。

建议动作：

- 已用 `shared/transport-utils.js` 替换 `background.js` 中重复的 SSE parser、raw body text/usage 解析。
- 把运行状态、active runs、port runs、取消控制抽成 `background/run-state.js`。
- 把右键菜单、快捷键、入口状态抽成 `background/entrypoints.js`。
- 把阅读会话清理和创建抽成 `background/reader-sessions.js`。

约束：

- `background.js` 当前通过 `importScripts` 加载依赖，拆分后继续保持 classic service worker 模式。
- 所有新 background 子文件需要在 `importScripts` 中显式加载。
- 不在同一阶段修改 provider adapter 的请求格式。

验收：

- 连接测试不变。
- 流式生成、非流式 fallback、取消生成、重试提示、endpoint 兼容错误提示不变。
- `TransportUtils` 的现有测试继续通过，并补后台调用路径的最小契约测试。

### Phase 4：存储和资料库能力升级

目标：在代码边界清晰后，把 Pinboard 启发落到资料库能力上。

建议动作：

- 补齐标签和备注编辑 UI，优先复用现有 `tags`、`notes` 字段。
- 搜索扩展到 `tags`、`notes`、`articleSnapshot.cleanText`，但需要先评估性能。
- 增加“只保存 / 稍后读 / 保存并总结”入口状态字段，例如 `readStatus` 或 `captureMode`。
- 增加导出器抽象：JSON、Markdown、Netscape HTML、Pinboard-compatible。
- 如果需要 IndexedDB 新索引，单独提升 `DB_VERSION`，写清迁移策略。

约束：

- 存储升级必须向后兼容旧记录。
- 不把全文搜索和 UI 重构混在一起。
- 大量记录性能要以简单可测的方式验证，例如 1k、10k 条记录的搜索耗时。

验收：

- 旧历史记录可读、可删、可收藏。
- 新字段缺失时 UI 有默认值。
- 导出文件可被重新导入或被外部服务识别。

### Phase 5：样式和页面结构减负

目标：避免 `style.css` 和页面 HTML 继续膨胀。

建议动作：

- 按区域拆样式：base、layout、source-card、trust-card、history、markdown、share-card。
- popup 的内联 CSS 可以后续迁移为 `popup.css`。
- 建立命名规范，避免新增功能继续堆通用类。

约束：

- 先拆文件，不重新设计视觉。
- 拆样式时避免同时改尺寸、颜色、间距。

验收：

- 侧栏、popup、reader 在明暗主题下视觉不变。
- 分享长图样式不受全局 CSS 拆分影响。

## 5. 首批推荐执行切口

第一批只做“减负型重构”，不做任何新功能。

建议顺序：

1. 已文档化验证命令，并由 `npm test` / `npm run test:e2e` 覆盖当前回归入口。
2. 已抽 `shared/ui-format.js`、`shared/ui-labels.js`、`shared/summary-text.js` 和侧栏/阅读/历史相关纯视图模型模块。
3. 已移除 `sidebar.js` 内重复的主题和收藏按钮函数定义，并补静态契约防回归。
4. 已用 `shared/transport-utils.js` 替换 `background.js` 的重复 SSE/raw body 解析函数。
5. 已把历史面板运行逻辑从 `sidebar.js` 迁出到 `sidebar/history.js`；后续优先在 Phase 3 中继续抽 `background/run-state.js`。

这五步的特点是收益明确、风险可控、功能感知小，适合作为技术债治理的起手式。

## 6. 回归清单

每次重构后至少检查：

- 右键菜单能打开侧栏并生成摘要。
- `Alt + S` 能触发入口。
- 当前页有历史时能优先显示历史摘要。
- “重新生成”使用当前页面上下文，而不是旧记录快照。
- 长文分段和最终汇总能正常运行。
- 二次生成的行动项、术语表、问答卡片能正常运行。
- 取消生成能停止流式输出并保留正确状态。
- 收藏、取消收藏、删除记录后历史面板刷新正确。
- Markdown 导出内容包含来源、站点和模式。
- 长截图分享卡能生成并下载。
- 阅读页能打开，并能复制 Markdown。
- 无痕模式不写入历史，分享开关按策略禁用。
- 连接测试和 endpoint 错误提示仍然可用。

## 7. 近期不做

- 不做完整云同步。
- 不做账号系统。
- 不做公开内容流。
- 不一次性切换完整技术栈。
- 不一次性重写 UI。

构建链、TypeScript 和 Preact 已拆到独立迁移设计中，必须证明能降低维护成本，并通过测试门禁后再逐步落地。
