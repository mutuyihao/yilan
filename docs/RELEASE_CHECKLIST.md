# Release Checklist

Last updated: 2026-07-01

This checklist is the fixed release gate for every version. Use it for both Chrome Web Store submission and the GitHub/community release package.

## Every Release Flow

- Bump the version in `package.json`, `package-lock.json`, `manifest.json`, and `shared/version.js`.
- Add a dated `CHANGELOG.md` entry for the target version.
- Update Chrome Web Store copy, version update notes, permission/privacy text, and known limitations in `docs/STORE_LISTING.md`.
- Update README and docs references when release gates, supported features, or user-visible workflows change.
- Run the automated gates below and keep the generated package artifacts under `release/yilan-<version>/`.
- Create an annotated tag after the release commit is ready: `git tag -a v<version> -m "Release <version>"`.
- Push the release commit and tag together: `git push origin master --follow-tags`.

## Automated Gates

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run test:e2e`
- `npm.cmd run package:release`

The release package script writes `release/yilan-<version>/`, `release/yilan-<version>-extension.zip`, and `release/yilan-<version>-package-manifest.json`. The package must not contain `node_modules`, tests, Playwright artifacts, private folders, landing-page files, or source-only docs.

## Manual Product Regression

- Load the packaged extension in a fresh Chromium profile.
- Verify popup settings, auto-save, connection profiles, provider route selection, endpoint preview, model refresh, connection test, `/v1` auto-adjustment, `endpointMode=auto` fallback, and entry status checks.
- Verify sidebar open via context menu and `Alt + S`, primary summary, secondary generation, cancel, diagnostics, history, favorites, and deletion.
- Verify Bilibili video pages: official AI summary path, subtitle fallback path, fallback metadata path, diagnostics panel, and `导出字幕` when subtitles are available.
- Verify YouTube video pages: caption extraction, watch HTML fallback, InnerTube fallback, translated caption path, metadata fallback, diagnostics panel, and subtitle export when captions are available.
- Verify reader page copy, source link behavior, diagnostics, and missing-session fallback.
- Verify Markdown export and share-card image export.
- Verify light, dark, system mode, and all four palettes: `jade`, `slate`, `copper`, `plum`.
- Verify restricted pages such as browser internal pages and extension store pages fail with expected browser-permission behavior.
- Smoke test Chrome, Edge, and Brave before public distribution.

## Chrome Web Store Submission

- Use `release/yilan-<version>-extension.zip`.
- Use the listing copy and permission rationale in `docs/STORE_LISTING.md`.
- Use `https://github.com/mutuyihao/yilan/blob/master/PRIVACY_POLICY.md` as the Chrome Web Store privacy policy URL.
- Upload screenshots from real extension surfaces: popup, sidebar, reader, history/favorites, and settings.

## GitHub / Community Release

- Attach `release/yilan-<version>-extension.zip`.
- Include the matching `CHANGELOG.md` entry for the target version.
- Include installation instructions for Load unpacked from the zip.
- Include known limitations: restricted browser pages cannot be injected; API behavior depends on the user's configured provider; no-trace mode does not stop sending page content to the configured model; Bilibili official summaries and subtitles depend on Bilibili page/API availability and login state; YouTube captions, translated captions, and player-response fallbacks depend on YouTube page/API availability and may degrade to metadata.
