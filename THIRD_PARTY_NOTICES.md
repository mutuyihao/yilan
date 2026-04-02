# Third-Party Notices

This repository contains original project code plus a small set of vendored third-party files.

- The original project code is licensed under `Apache-2.0`. See `LICENSE`.
- Third-party files remain under their respective upstream licenses.
- When redistributing packaged builds, keep the existing third-party license headers or provide equivalent notice text in your release artifacts.

## Included Third-Party Components

| Component | Vendored file(s) | Upstream | License | Notes |
| --- | --- | --- | --- | --- |
| Mozilla Readability | `libs/readability.js` | https://github.com/mozilla/readability | Apache-2.0 | Apache license header is preserved in the vendored file. |
| DOMPurify 3.2.4 | `libs/purify.min.js` | https://github.com/cure53/DOMPurify | Apache-2.0 OR MPL-2.0 | Upstream offers a dual license. The original upstream header is preserved in the vendored file. |
| Marked v15.0.7 | `libs/marked.min.js` | https://github.com/markedjs/marked | MIT | Copyright and license notice is preserved in the vendored file. |
| highlight.js v11.9.0 | `libs/highlight.min.js` | https://github.com/highlightjs/highlight.js | BSD-3-Clause | Copyright and license notice is preserved in the vendored file. |
| highlight.js GitHub Dark theme | `libs/github-dark.min.css` | https://github.com/highlightjs/highlight.js | BSD-3-Clause | Distributed as part of the highlight.js style set. Theme attribution metadata is preserved in the vendored file. |
| html2canvas 1.4.1 | `libs/html2canvas.min.js` | https://github.com/niklasvh/html2canvas | MIT | Copyright and license notice is preserved in the vendored file. |

## Project-Specific Clarification

- `LICENSE` applies to this repository's original code and documentation unless a file says otherwise.
- Files under `libs/` that originate from third parties are not relicensed by the root `LICENSE`.
- If a third-party file header or upstream license text conflicts with this summary, follow the upstream license text and the notices preserved in that file.
