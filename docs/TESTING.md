# 测试体系

Last updated: 2026-04-15

当前测试体系分成两层：

- Node 层：无浏览器、跑得快，用来锁住纯逻辑、存储和静态契约。
- Playwright 层：真实 Chromium + 已加载扩展，用来验证用户主链路。

测试依赖只进入 `devDependencies`，不会改变扩展运行代码或 Manifest V3 形态。

## 覆盖口径

`npm test` 实际运行的是 `node tests/run-tests.js`。当 `tests/feature-matrix.js` 中的既有功能都被对应测试命中时，harness 会输出 `Feature coverage: 100%`。

这个 `100%` 的含义是“既有功能清单全部被覆盖”，不是 Istanbul / V8 的行覆盖率或分支覆盖率。

当前覆盖拆分如下：

- 纯逻辑和领域工具：用 Node 单元测试覆盖。
- IndexedDB 记录层：用 `tests/fake-indexeddb.js` 覆盖存取、搜索、收藏、删除、复用等行为。
- 浏览器页面和 Manifest V3 入口：用静态契约测试覆盖 DOM id、脚本加载顺序、消息 action、权限和资源声明。
- 真实浏览器链路：用 Playwright 覆盖 popup、content script、background service worker、sidebar iframe、reader 页面和 mocked AI 接口之间的协作。

这套体系适合给“行为等价”的重构和技术债治理提供护栏，但它仍然不等于所有排列组合都自动化：

- 不是所有 provider 组合都做了 E2E。
- 不是所有视觉细节都做了像素级断言。
- 不是所有浏览器受限页面都适合被固化成自动化测试。

## 运行命令

```powershell
npm test
npm run test:e2e
```

首次运行 Playwright 前，通常需要先安装 Chromium：

```powershell
npm run playwright:install
```

在某些 Windows PowerShell 环境中，`npm.ps1` 可能被执行策略拦截；这种情况下可改用：

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run playwright:install
```

如果只想跑 Node 层，也可以直接执行：

```powershell
node tests/run-tests.js
```

## 测试分层

### Node 层

- `tests/harness.js`：轻量测试注册器和功能覆盖门禁。
- `tests/feature-matrix.js`：既有功能覆盖清单，新增功能必须同步增加或更新。
- `tests/unit-core.test.js`：领域工具、文章快照、分段、prompt、信任策略、错误、取消、诊断、preset、主题。
- `tests/unit-adapters-transport.test.js`：OpenAI/Anthropic adapter、registry、SSE/non-stream 解析和 transport 错误归一。
- `tests/unit-record-store.test.js`：记录存储、历史搜索、站点聚合、收藏删除、当前页复用、session-only 记录。
- `tests/static-contracts.test.js`：Manifest、HTML DOM 契约、脚本顺序、background/content/sidebar/popup/reader 入口契约，以及一方 JS 语法检查。
- `tests/fake-indexeddb.js`：面向记录层测试的最小内存 IndexedDB。

### 性能基线

- Node 层包含历史大数据基线：10k 条记录的站点聚合/过滤，以及 1k 条 IndexedDB 记录的搜索、收藏过滤和站点查询。
- 这些用例是退化报警，不是绝对性能评测。默认阈值偏宽，避免机器负载造成误报。
- 低性能 CI 可以临时设置 `YILAN_PERF_BUDGET_HISTORY_HELPERS_10K_MS` 和 `YILAN_PERF_BUDGET_INDEXEDDB_SEARCH_1K_MS` 调整阈值。
- 基线先锁定测试层；只有失败或新功能扩大查询范围时，再进入代码优化。

### Playwright 层

- `playwright.config.js`：Playwright 配置。
- `e2e/test-server.js`：本地 fixture 页面与 mock AI 接口。
- `e2e/extension-harness.js`：扩展加载、service worker、storage、侧栏触发 helper。
- `e2e/extension.spec.js`：浏览器端主链路测试。

## 新增功能要求

新增或调整功能时，需要同步处理：

- 在 `tests/feature-matrix.js` 中增加或调整 feature id。
- 为纯逻辑补 Node 单元测试。
- 为浏览器入口补静态契约测试，至少覆盖 DOM id、message action、Manifest 资源和脚本顺序。
- 如果功能会改变存储结构，补旧记录兼容测试。
- 如果功能属于高价值主链路，且能在浏览器里稳定复现，优先补 Playwright 用例。
- 如果功能暂时不适合自动化，至少补手工烟测说明，并在后续评估是否升级为 E2E。

## Playwright 范围

当前 Playwright 用例优先覆盖高价值主链路，而不是 provider 全排列：

- popup 设置保存与连接测试
- popup 自动保存
- popup 连接错误态
- 当前标签页注入侧栏并生成主摘要
- 超时、CORS、网络断开、流式断流等异常链路
- 短暂网络失败后的重试与诊断计数
- 多次短暂失败后的退避节奏与最终成功
- 长文分段与最终汇总
- 二次生成
- 历史复用
- 历史面板的收藏切换、删除、站点过滤
- 无痕模式不落库
- 分享关闭策略下的按钮禁用
- reader 页面打开与恢复
- 从历史记录而不是当前页快照打开 reader
- 从已取消历史记录打开 reader 并保留部分内容与诊断
- 失败历史记录无摘要时保持不可阅读状态
- reader 会话失效、历史记录缺失时的快照回退、无原文链接时的禁用态
- 取消生成
- Markdown 导出下载
- 分享长图下载

暂时不把所有 provider、所有站点类型、所有视觉细节都做成 E2E 断言，避免维护成本失控。

## 文档同步

测试命令、测试分层或覆盖口径发生变化时，至少同步更新：

- `docs/TESTING.md`
- `docs/DEVELOPER_GUIDE.md`
- `docs/README.md`
- `README.md` 中的验证入口
