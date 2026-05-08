# Changelog

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
