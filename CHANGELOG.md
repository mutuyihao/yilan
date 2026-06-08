# Changelog

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
