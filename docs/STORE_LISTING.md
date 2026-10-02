# Chrome Web Store Listing（商店列表文案与提交素材）

Last updated: 2026-10-02

说明：商店条目名称与简短介绍自 1.5.0 起经 `_locales/*/messages.json` 的 `extName` / `extDescription` 随包下发（中文面向 zh 商店、英文面向 en 商店），改文案即改包；CWS 后台的「简短描述」和「详细描述」可随时更新，零代码。所有字段长度已按 CWS 限制核验（名称 ≤45 字符，简短描述/manifest 描述 ≤132 字符）。

## 标题（≤45 字符，已随 1.5.0 包通过 `_locales` 生效）

品牌在前保留中英文双搜索入口，补齐最高频搜索词「AI 摘要 / 插件 / 网页 / YouTube / B站 / 总结」：

```
一览 Yilan - AI 摘要插件：网页/YouTube/B站总结
```

英文商店（en listing）：

```
Yilan - AI Summaries: Web, YouTube, Bilibili
```

理由：CWS 搜索里标题权重最高；「插件」比「扩展」搜索量更高，「摘要/总结」双词都覆盖，YouTube/B站是场景词；「AI 阅读工作台」是品牌叙事，不是搜索词，已弃用。

## 简短描述（Short Description，≤132 字符，CWS 后台立即可改）

```
AI 摘要浏览器插件：总结网页、YouTube 与 B 站视频，自带 API Key（BYOK）。结构化摘要、行动项/术语表二次生成、本地历史与专注阅读。
```

## 详细描述（立即可改）

前两行是折叠前的黄金位置：放核心关键词（AI 摘要、浏览器插件、网页/YouTube/B站）+ 一句话价值主张。

```
一览（Yilan）是本地优先的 AI 摘要浏览器插件：把网页文章、YouTube 视频和 B 站视频一键变成结构化总结，还能继续加工成行动项、术语表与问答卡片，沉淀到本地历史，随时回看与导出。中英双语界面，跟随浏览器语言。

—— 三大场景，一个插件 ——
• 网页 AI 摘要：自动抽取正文、标题、作者与发布时间，长文自动分段；简短总结 / 标准总结 / 详细分析 / 关键要点四种模式
• YouTube 视频总结：优先读取字幕与翻译字幕，多级来源回退，支持字幕导出——看视频前先看要点
• B 站视频总结：优先使用 B 站官方 AI 总结，字幕回退，支持字幕导出

—— 二次生成：一份总结，多种产出 ——
在已有总结上一键生成：行动项（待办清单）、术语表、问答卡片，适合课程、讲座与技术分享的整理与复习。

—— 自带 API Key（BYOK），支持 11+ 厂商 ——
OpenAI、Anthropic Claude、DeepSeek、Google Gemini、xAI Grok、通义千问 Qwen、智谱 GLM、MiniMax、豆包、腾讯混元、小米 MiMo，以及任意 OpenAI 兼容接口。内置连接测试与 Endpoint 自动探测，配置一次长期可用。

—— 本地优先，边界说清楚 ——
• 无账号体系，无内置统计与跟踪
• 页面内容只发送给你自己配置的模型服务商
• 历史仅存本地，可搜索、按站点筛选、收藏；可随时删除；无痕模式不写入历史
• 完全开源：https://github.com/mutuyihao/yilan

—— 使用方式 ——
在任意网页右键选择「用一览总结此页」，或按 Alt + S，侧边栏自动开始生成摘要。

适合长文阅读、视频学习、网课笔记、技术文档调研、资讯整理与知识沉淀的用户。
```

理由：厂商名（DeepSeek / GLM / Qwen / 豆包等）是真实支持的预设，写进描述能命中「XX 总结」「XX 摘要」这类搜索；「插件/摘要/总结/字幕/长文/行动项」等词自然分布在各段落，无堆砌（CWS 元数据政策禁止关键词堆砌与无关商标）；无账号、无跟踪、开源是可信度卖点，保持前置；新增场景词段落（网课笔记/技术文档/知识沉淀）扩大长尾搜索命中。

## 英文商店文案（en listing，i18n 已落地，可直接在 CWS 后台添加 English listing）

Title（≤45 字符）：

```
Yilan - AI Summaries: Web, YouTube, Bilibili
```

Short description（≤132 字符）：

```
AI summaries for web pages, YouTube & Bilibili videos. BYOK: bring your own API key. Chunked long reads, local history, focus reading.
```

Detailed description：

```
Yilan is a local-first AI summarizer extension for Chrome: turn web articles, YouTube videos, and Bilibili videos into structured summaries, then refine them into action items, glossaries, and Q&A cards — all saved to a local, searchable history.

— Three surfaces, one extension —
• Web page AI summaries: clean extraction of article body, title, byline, and publish time; automatic long-article chunking; four depth modes (brief / standard / detailed / key points)
• YouTube summaries: reads captions and translated captions with multi-level fallbacks; export subtitles — get the points before you watch
• Bilibili summaries: prefers Bilibili's official AI summary with caption fallback; export subtitles

— Second-pass generation —
From an existing summary, generate action items, a glossary, or Q&A cards in one click — great for lectures, talks, and study notes.

— Bring your own API key (BYOK) —
Works with OpenAI, Anthropic Claude, DeepSeek, Google Gemini, xAI Grok, Alibaba Qwen, Zhipu GLM, MiniMax, ByteDance Doubao, Tencent Hunyuan, Xiaomi MiMo, and any OpenAI-compatible endpoint. Connection testing and endpoint auto-detection built in.

— Local-first, clearly scoped —
• No account required, no built-in analytics or tracking
• Page content is sent only to the provider you configure
• History stays on your device: searchable, filterable by site, favoritable, deletable anytime; private mode writes nothing
• Fully open source: https://github.com/mutuyihao/yilan

— How to use —
Right-click any page and choose "Summarize with Yilan", or press Alt + S; the side panel starts summarizing immediately.
Interface in English or Chinese, following your browser language.

For long reads, video learning, research, and knowledge management.
```

## 截图顺序（CWS 后台可改）

素材在 `store-assets/chrome-web-store/`（`scripts/generate-store-assets.js` 生成，基础图来自 `npm run screenshots:landing`）。2026-09-13 已按搜索意图重排并新增视频场景首图：

1. [x] `screenshot-01-video-summary.jpg`——视频摘要场景（YouTube 侧栏 + 字幕导出），视频总结是最高频搜索意图
2. [x] `screenshot-02-summary-workspace.jpg`——网页摘要工作台
3. [x] `screenshot-03-follow-up-modes.jpg`——二次生成模式
4. [x] `screenshot-04-history-favorites.jpg`——历史收藏
5. [x] `screenshot-05-provider-setup.jpg`——厂商配置
6. [x] `screenshot-06-theme-modes.jpg`——主题模式（若 CWS 后台限制 5 张，此张作为备选）
7. [x] 宣传图 `promo-small.jpg`（440x280）/ `promo-marquee.jpg`（1400x560），标语已对齐「AI 摘要插件」定位

截图里的界面为真实扩展（mock 模型）产出，版本徽标为 v1.5.0；上传前在真实浏览器里打开检查清晰度即可。

## 分类与语言

- [ ] 分类确认：Productivity（工具效率类是此类扩展的主流分类）
- [ ] 语言：中文（简体）为主；i18n 批次已随 1.5.0 落地，英文 listing 文案见上文「英文商店文案」，可在 CWS 后台直接添加 English locale

---

以下为提交表单用的英文素材（权限说明、隐私答案等保持英文，便于直接粘贴）。

## Version Update Notes

Paste-ready Chrome Web Store update text:

1.6.0 adds a current-page home in the toolbar popup, saved-summary reuse, first-run setup guidance, a full-tab settings surface, truthful connection verification, quick summary options, and cross-window settings synchronization. It also carries everything since 1.0.0: internationalization, YouTube and Bilibili summaries, reader and history tools, provider setup, diagnostics, and hardened network handling.

Full user-visible changes since the 1.0.0 store version:

- 1.6.0: Added the current-page popup home, saved-summary reuse, full-tab settings, truthful connection status, quick summary options, and synchronization fixes for settings and profile changes made in another window.
- 1.5.1: Fixed switching between saved profiles so the previously active profile's settings are no longer overwritten by the newly activated profile; switching profiles now only applies the target profile's settings to the live configuration.
- 1.5.0: Localized every surface (extension name, popup, sidebar, reader, prompts) into Chinese/English with a user-selectable interface language, added a chunk concurrency setting (1-4) for long articles, added an API key show/hide toggle, hardened streaming retries/timeouts and rate-limit handling, consolidated popup styles into a single stylesheet, and simplified the connection tab around a provider → API Key → model flow.
- 1.4.1: Added a popup setting for default compact sidebar mode, preserved standard sidebar mode as the full information layout, and improved theme-linked colors for compact controls, summary scrollbars, standalone reader backgrounds, and footer status text.
- 1.3.0: Added YouTube video summaries using captions where available, with DOM player response, watch HTML, InnerTube, JSON/XML caption parsing, translated caption candidates, stale SPA response handling, metadata fallback, diagnostics persistence, and summary-selected subtitle export.
- 1.2.0: Added Bilibili video summaries using video metadata, official Bilibili AI summaries when available, subtitle fallback, diagnostics, and Bilibili subtitle export.
- 1.1.1: Added a floating document navigation panel to the standalone reader, heading anchors, active-section highlighting, and better long-title handling.
- 1.1.0: Redesigned provider setup around provider selection, recommended Base URL routes, API Key entry, connection testing, generated provider catalog governance, and clearer automatic/manual endpoint modes.
- 1.0.1: Added Xiaomi MiMo provider presets, MiMo Token Plan regional routes, endpoint inference, and API-key validation for incompatible MiMo credential types.
- Quality and release readiness: Expanded Node/unit/static/E2E coverage, documented platform limitations, refreshed release metadata, and updated Chrome Web Store packaging guidance.

## Permission Rationale

- `activeTab`: reads the current tab only after the user triggers summarization.
- `scripting`: injects the content extraction script and sidebar iframe.
- `storage`: stores provider settings, preferences, entry state, and local runtime caches.
- `contextMenus`: adds the right-click entry point.
- `clipboardWrite`: copies summaries and export text.
- `host_permissions: <all_urls>`: required because users can summarize arbitrary web pages, fetch YouTube/Bilibili video and subtitle source data when triggered on supported video pages, and configure arbitrary AI-compatible API endpoints.

## Privacy Answers

- Yilan does not collect analytics or telemetry.
- Yilan does not operate a server that receives page content, API keys, or history.
- Page content, YouTube/Bilibili video metadata, or subtitle text is sent directly from the browser to the user's configured AI provider when model generation is needed.
- On Bilibili video pages, Yilan may request Bilibili metadata, official AI summary, player, and subtitle endpoints from the browser. If an official Bilibili AI summary is available, the primary result can use it without an extra AI-provider request.
- On YouTube video pages, Yilan may read player response data from the page and request YouTube watch/player/caption endpoints from the browser to locate captions or fallback metadata.
- API keys are stored in `chrome.storage.sync`, which may sync through the user's browser account depending on browser settings.
- Summary history is stored locally in IndexedDB and can be deleted by the user.

## Privacy Policy URL

- Use `https://github.com/mutuyihao/yilan/blob/master/PRIVACY_POLICY.md` in the Chrome Web Store privacy policy field.

## Known Limitations

- Browser internal pages, extension store pages, and other restricted URLs cannot be injected due to Chromium security rules.
- Provider compatibility depends on the chosen API endpoint and its CORS behavior.
- Custom API endpoints must use HTTPS unless they point to localhost or a LAN address.
- YouTube captions, translated captions, and player-response fallbacks depend on YouTube page/API availability and may degrade to metadata-only summaries.
- Bilibili official summaries and subtitles depend on Bilibili page/API availability, video support, and the current browser login state.
- Bilibili support currently targets `bilibili.com/video/BV...` video pages and may degrade to title/description-only summaries when official summaries or subtitles are unavailable.
- No-trace mode prevents local history writes but does not prevent sending page content to the configured model provider.

## Disclaimer Notes

- Yilan is not an official Bilibili product and is not affiliated with, endorsed by, or warranted by Bilibili.
- Summaries and exported subtitles are personal reading aids, not official transcripts, complete substitutes for source videos, or guarantees of factual accuracy.
- Users should follow copyright rules, platform terms, and creator rights when using or sharing exported text.
