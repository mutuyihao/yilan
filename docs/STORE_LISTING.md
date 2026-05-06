# Chrome Web Store Listing Draft

Last updated: 2026-05-05

## Title

一览 - AI Reading Workspace

## Short Description

Summarize web pages with your own AI provider, save local history, and read results in a focused view.

## Long Description

一览 is a local-first Chromium extension for web reading workflows. It extracts article content from the current page, sends it directly to the AI provider you configure, and presents a readable summary in a sidebar. You can continue processing a result into action items, glossary entries, or Q&A cards, then keep it in local history or open it in a focused reader.

Key features:

- BYOK provider setup with OpenAI, Anthropic, custom compatible gateways, and regional provider presets.
- Explicit or automatic endpoint modes for Responses, Chat Completions, legacy Completions, and Anthropic Messages.
- Local IndexedDB history, favorites, page-level reuse, and no-trace mode.
- Sidebar workspace, focused reader page, Markdown export, and share-card image export.
- Light/dark/system theme mode plus four palette presets.
- No analytics, no tracking, and no vendor server operated by Yilan.

## Permission Rationale

- `activeTab`: reads the current tab only after the user triggers summarization.
- `scripting`: injects the content extraction script and sidebar iframe.
- `storage`: stores provider settings, preferences, entry state, and local runtime caches.
- `contextMenus`: adds the right-click entry point.
- `clipboardWrite`: copies summaries and export text.
- `host_permissions: <all_urls>`: required because users can summarize arbitrary web pages and can configure arbitrary AI-compatible API endpoints.

## Privacy Answers

- Yilan does not collect analytics or telemetry.
- Yilan does not operate a server that receives page content, API keys, or history.
- Page content is sent directly from the browser to the user's configured AI provider when the user triggers a summary.
- API keys are stored in `chrome.storage.sync`, which may sync through the user's browser account depending on browser settings.
- Summary history is stored locally in IndexedDB and can be deleted by the user.

## Privacy Policy URL

- Use `https://github.com/mutuyihao/yilan/blob/master/PRIVACY_POLICY.md` in the Chrome Web Store privacy policy field.

## Known Limitations

- Browser internal pages, extension store pages, and other restricted URLs cannot be injected due to Chromium security rules.
- Provider compatibility depends on the chosen API endpoint and its CORS behavior.
- Custom API endpoints must use HTTPS unless they point to localhost or a LAN address.
- No-trace mode prevents local history writes but does not prevent sending page content to the configured model provider.
