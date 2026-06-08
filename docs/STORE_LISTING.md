# Chrome Web Store Listing Draft

Last updated: 2026-06-08

## Title

一览 - AI Reading Workspace

## Short Description

Summarize web pages, YouTube and Bilibili videos with your own AI provider, local history, reader, and exports.

## Long Description

一览 is a local-first Chromium extension for web and video reading workflows. It extracts article content from the current page, handles YouTube and Bilibili video pages with caption, official-summary, or metadata fallbacks, sends source text directly to the AI provider you configure when model generation is needed, and presents a readable summary in a sidebar. You can continue processing a result into action items, glossary entries, or Q&A cards, then keep it in local history or open it in a focused reader.

Key features:

- Web article extraction with page-type strategy detection and long-article chunking.
- YouTube video summaries with caption and translated-caption extraction, DOM/watch-page/InnerTube recovery, diagnostics, metadata fallback, and subtitle export.
- Bilibili video summaries with video metadata, official AI summary fast path, subtitle fallback, diagnostics, and subtitle export.
- BYOK provider setup with OpenAI, Anthropic, custom compatible gateways, regional provider presets, generated provider catalog, and recommended Base URL routes.
- Explicit or automatic endpoint modes for Responses, Chat Completions, legacy Completions, and Anthropic Messages.
- Local IndexedDB history, favorites, page-level reuse, and no-trace mode.
- Sidebar workspace, focused reader page with document navigation, Markdown export, and share-card image export.
- Light/dark/system theme mode plus four palette presets.
- No analytics, no tracking, and no vendor server operated by Yilan.

## Version Update Notes

Paste-ready Chrome Web Store update text:

1.3.0 adds YouTube video summaries with caption/translated-caption extraction, fallback recovery, diagnostics, metadata fallback, and subtitle export. Since the 1.0.0 store version, Yilan also added Bilibili video summaries and subtitle export, a reader document navigation panel, a redesigned provider setup flow, MiMo route/key validation improvements, broader diagnostics, and updated release gates.

Full user-visible changes since the 1.0.0 store version:

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
