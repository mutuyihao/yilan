# Yilan

Last updated: 2026-04-29

Language: English | [中文](README.zh-CN.md)

Website: <https://yilan.app>
GitHub: <https://github.com/mutuyihao/yilan>
Community: <https://discord.gg/MWWDwXZ2TV>

Yilan is a Manifest V3 Chromium extension for the full web reading workflow: extract a page, generate a summary, continue processing it, save it locally, and read it in a focused view.

The current version is no longer just a summarizer. It is a local-first web reading workspace:

- Extracts article text, title, author, publish time, and site information automatically.
- Detects page type and recommends a summary strategy for that page.
- Supports four primary summary modes: `Brief Summary`, `Standard Summary`, `Detailed Analysis`, and `Key Points`.
- Supports three follow-up generation modes: `Action Items`, `Glossary`, and `Q&A Cards`.
- Shows source metadata, trust and control state, history, favorites, and basic diagnostics in the sidebar.
- Can reuse the current page's latest historical summary at entry time, while keeping `Regenerate` available to refresh the page result.
- Refreshes sidebar context after same-document SPA route changes without automatically starting a new model request by default.
- Opens the current summary in a standalone new-tab reader.
- Exports Markdown and creates long screenshot share cards with source links.
- Provides provider presets, explicit Endpoint Mode, theme preference, entry status checks, and auto-save in the settings page.
- Uses a two-layer test baseline: `Node feature matrix + static contracts` and `Playwright browser main flow`, which protects future refactors and technical-debt cleanup.

## Current Scope

- Yilan is `local-first + BYOK`; it does not include built-in accounts or cloud sync.
- Incognito mode only controls whether results are written to local history. It does not prevent page content from being sent to the model service you configure.
- History is stored only in IndexedDB for the current browser profile.
- The extension currently targets Chromium browsers and uses the context menu plus `Alt + S` as the main entry points.

## Quick Start

### 1. Load the extension

1. Open Chrome, Edge, or another Chromium browser.
2. Go to the browser's extensions management page.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select this project directory.

### 2. Configure a model

1. Click the extension icon to open the settings page.
2. In the `Connection` tab, choose a provider preset, Provider, and Endpoint Mode.
3. Enter your `API Key`, and override `Base URL` or `Model` if needed.
4. Wait for auto-save to finish, then click `Test Connection`.

Notes:

- The settings page auto-saves by default; you do not need to click Save first.
- Text inputs are saved after a short pause, and also save immediately on `blur`.
- Select boxes and switches save immediately.
- Built-in provider presets currently include OpenAI, Anthropic, DeepSeek, Gemini, xAI, Qwen, GLM, MiniMax, Doubao, and Hunyuan.

### 3. Use the extension

1. Open any web page.
2. Right-click the page and choose the Yilan summary action, or press `Alt + S`.
3. When the sidebar opens, it checks the entry configuration first. If history reuse is enabled and a completed result exists for the current page, the latest result is shown immediately. Otherwise, generation starts automatically, or the sidebar waits for manual action depending on your settings.
4. Use the sidebar to read the summary, generate action items / glossary / Q&A cards, and manage history or favorites.
5. For focused reading, click the reader button at the top to open the result in a dedicated new tab.

## Development

Common validation commands:

```powershell
npm test
npm run test:e2e
```

Before running browser tests for the first time, install Chromium:

```powershell
npm run playwright:install
```

If Windows PowerShell blocks `npm.ps1`, use:

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run playwright:install
node tests/run-tests.js
```

For details about test scope, test layers, and requirements for new features, see [Testing](docs/TESTING.md). For the development workflow, manual regression checklist, and documentation maintenance rules, see [Developer Guide](docs/DEVELOPER_GUIDE.md).

## Repository Layout

```text
.
|-- adapters/                  # Provider adapters
|-- docs/                      # Docs index, user/architecture/testing/dev docs, planning drafts
|-- e2e/                       # Playwright browser tests and extension harness
|-- icon/                      # Extension icons
|-- landing-page/              # Static website
|-- libs/                      # Third-party libraries
|   |-- readability.js          # Vendored Readability for article extraction
|   |-- purify.min.js           # DOMPurify for sanitizing rendered Markdown HTML
|   |-- marked.min.js           # Marked for Markdown -> HTML rendering
|   |-- highlight.min.js        # highlight.js for code block highlighting
|   |-- github-dark.min.css     # Markdown / code block highlight styles
|   `-- html2canvas.min.js      # Long screenshot share card generation
|-- shared/                    # Domain utilities, page strategy, trust policy, theme, transport utilities, provider presets
|-- tests/                     # Node feature matrix, unit tests, static contracts
|-- background.js              # Background orchestration, entry state, run control, reader sessions
|-- content.js                 # Page extraction and sidebar injection
|-- db.js                      # IndexedDB history storage and migrations
|-- manifest.json              # Extension manifest
|-- playwright.config.js       # Playwright config
|-- popup.html / popup.js      # Settings page, tabs, auto-save, entry checks
|-- reader.html / reader.js    # Standalone reader page
|-- sidebar.html / sidebar.js  # Sidebar workflow, history, sharing, diagnostics
`-- style.css                  # Sidebar styles
```

## Documentation

Most project docs are currently written in Chinese:

- [Documentation index](docs/README.md)
- [User Guide](docs/USER_GUIDE.md)
- [Technical Architecture](docs/TECHNICAL_ARCHITECTURE.md)
- [Testing](docs/TESTING.md)
- [Developer Guide](docs/DEVELOPER_GUIDE.md)
- [Upgrade Design draft](docs/UPGRADE_DESIGN.md)
- [TypeScript + Preact Migration draft](docs/TS_PREACT_MIGRATION.md)
- [Contributing](CONTRIBUTING.md)

## License

- Original project code and documentation are licensed under `Apache-2.0`; see `LICENSE`.
- Third-party libraries distributed under `libs/` keep their respective upstream licenses; see `THIRD_PARTY_NOTICES.md`.
- If a third-party file header differs from this note, the notice preserved in that third-party file and its upstream license text take precedence.

## Acknowledgements

This project received help from the [LINUX DO](https://linux.do/latest) community during development. The product is released to the community, and its support is appreciated.
