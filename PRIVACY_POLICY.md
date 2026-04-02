# Privacy Policy — Yilan

**Last Updated: 2026-04-02**

Official website: https://yilan.app
Source code: https://github.com/mutuyihao/yilan

## Overview

Yilan is a browser extension that summarizes web articles using AI models. This policy explains how we handle your data.

## Data Collection

**We do not collect, store, or transmit any personal data to our servers.**

- All summarization history is stored **locally** in your browser's IndexedDB.
- Your settings (including API keys) are stored in Chrome's `chrome.storage.sync`, which may sync across your signed-in Chrome browsers via your Google account.
- No analytics, telemetry, or tracking of any kind is included in this extension.

## Data Sent to Third Parties

When you generate a summary, the **article content from the current webpage** is sent to the AI provider you have configured (e.g., OpenAI, Anthropic, DeepSeek, or a custom endpoint). This is necessary to produce the summary.

- The extension only sends data when **you explicitly trigger** a summary (via right-click menu, keyboard shortcut, or button click).
- The data is sent directly from your browser to the AI provider's API endpoint using **your own API key** (BYOK model).
- We have no access to your API key or the content you summarize.
- Please review the privacy policy of your chosen AI provider to understand how they handle the data.

## Permissions Explained

| Permission | Reason |
|------------|--------|
| `activeTab` | Access the content of the current tab when you trigger a summary |
| `scripting` | Inject the content extraction script into the active page |
| `storage` | Save your settings and preferences |
| `contextMenus` | Add "Summarize this page with Yilan" to the right-click menu |
| `clipboardWrite` | Copy summaries to your clipboard |
| `host_permissions: <all_urls>` | Required to (1) extract content from any webpage and (2) send API requests to user-configured AI endpoints at arbitrary URLs |

## Privacy Mode

The extension includes a **Privacy Mode** that prevents summaries from being saved to local history. Even in normal mode, all data stays in your browser — nothing is sent to us.

## API Key Storage

Your API key is stored in `chrome.storage.sync`. If you have Chrome sync enabled, this may be synced to your Google account. If this is a concern:
- Disable Chrome sync for extensions, or
- Use a browser profile with sync disabled.

## Data Deletion

- You can delete individual or all summary records from the history panel.
- Uninstalling the extension removes all locally stored data.

## Open Source

This extension is open source. You can audit the complete source code at any time: https://github.com/mutuyihao/yilan

## Changes

We may update this policy. Changes will be noted in the extension's changelog.

## Contact

For questions about this privacy policy, please open an issue on our GitHub repository: https://github.com/mutuyihao/yilan
