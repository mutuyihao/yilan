# Changelog

## 1.6.0 - 2026-10-02

- Turned the toolbar popup from a settings form into a "此页" (This page) home: it shows the current tab's title, favicon, and page kind, previews the saved summary when the page was summarized before, and offers one primary action that opens the sidebar through the same path as the context menu and `Alt + S` (so auto-start, short-mode, and history-reuse settings apply). The button label says what will happen ("总结此页" / "打开已有摘要" / "在侧栏中打开"), shows the user's actual shortcut binding, and closes the popup once the sidebar is open. Browser-internal pages, extension stores, and local files without file access explain why they cannot be summarized instead of failing silently.
- Added a first-run setup card on the home view (provider → API key → model) with a "set up in a full tab" path, since popups close when the user switches away to copy an API key.
- Registered `popup.html` as the extension options page (`options_ui`, opens in a tab): the same document renders a wide settings layout there, so the toolbar right-click "Options" entry now works. `popup/surface.js` resolves the surface before first paint.
- Made the connection status truthful: the last connection test is stored locally with a hash of the connection fields (never the raw key), and the status reads "待完成配置 / 未验证 / 已验证 · 3 分钟前 / 上次测试失败" instead of claiming "ready" as soon as fields were filled. Test results and key/base-URL validation now appear next to their controls, not only in the footer.
- Merged "自动翻译输出" and "默认输出语言" into one "摘要语言" choice (Auto or a fixed language) with a mirrored quick select on the home view; added "简短" / "无痕" quick chips that toggle the same settings. The stored `autoTranslate` / `defaultLanguage` keys are unchanged.
- Rail tabs now show text labels; "入口" is renamed "快捷入口"; the system prompt and chunk concurrency moved into a collapsed "高级" section; profiles moved below the model connection.
- Fixed an open popup or settings tab writing its stale form back over settings saved elsewhere (another popup, the options tab, or a background auto-fix) when it autosaved or closed.
- Added `triggerSummary` (and an optional `tabId` for `triggerHistory`) to the background runtime messages, and `db.findReusableRecordByUrl()` to look up a page's summary through the `normalizedUrl` index without loading the whole history.
- Added unit coverage for the home helpers and controller and the URL-indexed record lookup, plus Playwright specs for the home summarize/reuse flow, restricted pages, quick options, the stored connection status, and cross-window settings sync. `npm run screenshots:popup` now captures the popup at its real toolbar size.

## 1.5.1 - 2026-09-13

- Fixed switching between saved profiles overwriting the previously active profile: activating profile B ran the settings persist while the active profile id still pointed at A, so B's freshly applied settings were written into A's storage slot. `persistSettings` now accepts `skipProfileSync`, and profile activation uses it so switching only writes the main settings keys while profile slots and the index are updated by the activation flow itself.
- Added popup profile unit tests covering A→B→A switching and the unbound state, asserting previously saved profile payloads stay intact.

## 1.5.0 - 2026-09-13

- Renamed the extension to "一览 Yilan - AI 摘要插件：网页/YouTube/B站总结"（英文 "Yilan - AI Summaries: Web, YouTube, Bilibili"）and rewrote the store-facing descriptions around search keywords; also fixed the English manifest description exceeding Chrome's 132-character limit.
- Consolidated the popup settings styles into the single `popup-premium.css` stylesheet (the inline `<style>` block was removed from `popup.html`); DOM ids, `data-i18n`, and `data-autosave` hooks stay unchanged.
- Added a show/hide visibility toggle for the API key field in the popup, with localized labels in both locales and `aria-pressed` state.
- Added a user-facing chunk concurrency setting (1-4, default 2) in the popup preferences tab: it controls how many long-article chunk summaries run in parallel, with 1 keeping fully sequential requests for strictly rate-limited gateways.
- Speed up long-article summaries by running chunk requests two at a time (results and progress stay in chunk order; cancellation and failure semantics are unchanged), and bound streaming memory by capping the raw SSE capture used for previews and fallback parsing; stream readers are also closed on parse failures instead of leaving the connection open.
- Hardened the network layer: streaming retries now restart the visible output instead of appending to partial text (this also fixed duplicated copy in saved records); the request deadline now covers response-body reads with a 30s stall watchdog for streams; `/models` requests gained a 15s timeout; auto-endpoint compatibility probes run with a short 20s deadline; 429/5xx responses honor `Retry-After` while other 4xx statuses fail fast instead of retrying; exponential backoff now uses full jitter; and the sidebar pings the stream port mid-run to keep the MV3 service worker alive.
- Localized the model-connector catalog: all 12 provider presets, 26 routes (labels, hints, API-Key hints, key-prefix rules), and the five endpoint modes now resolve through locale catalogs under id-derived keys, with the generated Chinese catalog as fallback; a contract test keeps both locales in sync with the generated catalog.
- Added a user-selectable interface language (跟随浏览器/中文/English) in the popup appearance tab: the choice is persisted as `uiLanguage`, applied before first paint in the popup, sidebar, reader, and service worker through fetched locale catalogs, switched live via storage change events, and it also pins the prompt locale. Error-catalog and label lookups now resolve lazily so the override applies to runtime copy as well.
- Fixed the extension failing to load ("Variable $p1$ used but not defined"): the `reader_read_minutes` catalog message now declares its placeholder in both locales, and a new i18n contract test rejects any message referencing an undefined placeholder before packaging.
- Fixed locale catalogs loading after their consumers in popup, sidebar, and reader pages: `shared/i18n.js` now loads before `shared/errors.js`/`shared/ui-labels.js` so labels and error copy follow the browser locale again, with script-order contract coverage.
- Aligned the E2E content-script injection list with the production background list (adds `shared/constants.js`) and pinned the E2E prompt locale via target-language settings, since Playwright's chromium ships no locale packs; all 29 Playwright E2E specs now pass.
- Added full UI internationalization (chrome.i18n) with zh_CN and English catalogs: extension name/description, popup, sidebar, reader, context menu, background notifications, and the error catalog now follow the browser locale. Chinese output stays byte-identical to previous versions.
- Localized the AI prompt pipeline by output language first (zh/en), then UI locale, then Chinese: summary mode prompts, format skeletons, Markdown output rules, chunk/synthesis/secondary glue copy, and per-strategy focus instructions all have reviewed English variants; other output languages keep the localized prompt body plus the existing output-language instruction.
- Added `shared/i18n.js` (YilanI18n) with `data-i18n` DOM bindings, locale catalogs under `_locales/`, and unit coverage for catalog completeness and placeholder substitution.
- Localized summary mode, record status, strategy, chunking, and warning labels through `shared/ui-labels.js`; Markdown export headers and the share card follow the locale as well.
- Pinned the E2E browser locale to zh-CN (`--lang=zh-CN`) so text assertions stay stable across machines; Node tests resolve UI copy through the injected zh_CN catalog.
- Landing page SEO follow-ups: remaining screenshots converted to WebP (about 1.8MB saved), lazy loading plus hero fetch priority, dedicated 1200x630 OG share image, AI-crawler robots rules, and root favicon.ico fallback.
- Added a GitHub Actions CI workflow running typecheck, unit/contract tests, and Playwright E2E on pushes and pull requests.
- Added a release version-consistency contract test covering package.json, package-lock.json, manifest.json, and shared/version.js.
- Simplified the popup connection tab around a provider → API Key → model flow, moving routes, custom Base URL, protocol, and endpoint mode into one collapsed advanced section.
- Removed the redundant connection summary grid and the inline route panel toggle; profile management now sits in a compact section below the test action.
- Kept provider settings, profiles, IndexedDB history, reader sessions, model cache storage, and runtime message actions compatible with previous versions.
- Refactored the popup into dedicated theme, profile, provider-selection, model, and entrypoint controllers while keeping `popup.js` as the runtime entrypoint.
- Centralized Chrome callback APIs and persisted storage-key constants, and split background endpoint/model caches into isolated modules.
- Fixed popup/background model-cache key mismatches for default OpenAI-compatible endpoints and normalized endpoint suffixes consistently.
- Improved history and storage performance with a reused IndexedDB connection, single-pass site grouping, debounced stale-safe history search, batched DOM rendering, and reduced repeated sidebar/reader DOM work.
- Consolidated text-file downloads, removed dead sidebar stats/UI styles, and fixed custom prompt paragraphs to use real line breaks.

## 1.4.1 - 2026-06-27

- Added a popup setting for default compact sidebar mode so the sidebar can always open with more space reserved for the summary.
- Kept standard sidebar mode as the full information layout with source metadata, trust controls, actions, status, and diagnostics visible.
- Improved theme-linked colors for compact sidebar controls, summary scrollbars, standalone reader backgrounds, and footer status text.

## 1.3.0 - 2026-06-08

- Added YouTube video summaries with caption-based source extraction, player-response discovery, and metadata fallback.
- Improved YouTube caption recovery across DOM, watch HTML, InnerTube, JSON/XML formats, translated candidates, and stale SPA player responses.
- Simplified YouTube subtitle export to reuse the summary-selected subtitle artifact and preserve translated track metadata.
- Added unit coverage for YouTube extraction, diagnostics persistence, and video subtitle export behavior.

## 1.2.0 - 2026-05-24

- Added Bilibili video-page summaries with a dedicated extractor for video metadata, official Bilibili AI summaries, subtitles, and fallback page information.
- Added a sidebar subtitle export action for Bilibili videos when subtitle JSON or plain text is available.
- Added Bilibili extraction diagnostics, official-summary fast path, subtitle fallback coverage, and E2E/static contract coverage.
- Updated release metadata and product copy for the new Bilibili video workflow.

## 1.1.1 - 2026-05-24

- Added a floating document navigation panel to the standalone reader page based on rendered Markdown headings.
- Improved reader navigation behavior with heading anchors, active-section highlighting, and long-title handling.
- Removed the landing page header version pill for a cleaner navigation layout.

## 1.1.0 - 2026-05-08

- Redesigned provider setup around provider selection, recommended Base URL routes, API Key entry, and connection testing.
- Added a generated provider catalog and build-time catalog update script for official Base URL governance.
- Added explicit MiMo Token Plan CN, SGP, and AMS route choices for both OpenAI-compatible and Anthropic-compatible endpoints.
- Kept existing provider settings storage compatible while moving protocol and Endpoint Mode controls into advanced settings.

## 1.0.1 - 2026-05-08

- Added Xiaomi MiMo provider preset with both OpenAI-compatible and Anthropic-compatible base URLs.
- Added MiMo endpoint inference for both pay-as-you-go and Token Plan domains.
- Added MiMo API key validation so `sk-` and `tp-` credentials do not get mixed across incompatible domains.

## 1.0.0 - 2026-05-05

Yilan's first formal release.

- Rebuilt the extension UI around a shared light-first design system with dark-mode parity.
- Added theme mode and palette controls, including `jade`, `slate`, `copper`, and `plum`.
- Added provider presets, explicit endpoint modes, connection diagnostics, and model list refresh.
- Added local history, favorites, reader sessions, Markdown export, and share-card image export.
- Added no-trace mode and clearer trust-policy badges for history and sharing behavior.
- Added version labels across extension surfaces and aligned package metadata to `1.0.0`.
- Added release packaging, Chrome Web Store preparation notes, and formal release gates.
