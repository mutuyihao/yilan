# Yilan Design System

Last updated: 2026-10-02

Yilan uses a light-first editorial UI with a warm cream canvas, charcoal ink, restrained teal accent, and serif display typography for Chinese reading contexts.

## Tokens

- Light base: `#F7FAF7`
- Light surface: `rgba(255, 255, 255, 0.94)`
- Light ink: `#1A2028`
- Light muted: `#5D6B7A`
- Light accent: `#0B8A6F`
- Dark base: `#0A0E12`
- Dark surface: `rgba(16, 22, 30, 0.88)`
- Dark ink: `#EEF2F7`
- Dark muted: `#8A99AA`
- Dark accent: `#2BBF9A`

Shared variables live in [design-tokens.css](design-tokens.css). This is the single source for color tokens, theme mappings, and palette overrides. Surface CSS should reference variables such as `--bg`, `--surface`, `--panel`, `--line`, `--text`, `--accent`, `--warning`, and `--body-bg` instead of declaring page-specific palettes.

Palette switching uses `data-palette` on `:root` and is persisted as `themePalette` in extension sync storage. Current palettes are `jade` (松石绿), `slate` (雾蓝), `copper` (岩茶棕), and `plum` (檀紫). Each palette maps both light and dark accents, focus rings, brand gradients, accent-soft backgrounds, and page ambience.

## Typography

- Display: `Noto Serif SC`, then platform Chinese serif fallbacks.
- Body: `IBM Plex Sans`, `Noto Sans SC`, then platform sans fallbacks.
- Mono: `SF Mono`, `Cascadia Code`, `Consolas`.
- UI body text starts at `13px`; reader content uses `16px` with `1.75` line-height.

Typography helpers live in [typography.css](typography.css).

## Components

Reusable button, card, badge, focus, selection, and scrollbar primitives live in [components.css](components.css). Surface-specific files refine them for each context:

- [popup-premium.css](popup-premium.css)
- [sidebar-premium.css](sidebar-premium.css)
- [reader-premium.css](reader-premium.css)
- [landing-page/premium.css](landing-page/premium.css)

## Surface Rules

Popup is a fixed 452px panel with a 68px brand rail of labelled tabs. It opens on the "此页" home view (current-page card, saved-summary preview, one brand-gradient primary action, quick option chips, connection and history rows) and must fit Chrome's 600px popup height without scrolling; settings tabs scroll, with a sticky footer status that the home view only shows for warnings and errors. The connection status card is a calm surface card whose dot and label follow the truthful state (setup needed / unverified / verified / failed); the brand gradient is reserved for primary actions. The same document is the full-tab options page (`:root[data-surface='tab']`): a 248px labelled sidebar and a centered 760px settings column, without the home view.

Sidebar is injected at 420px wide and prioritizes a readable source card, compact trust policy, segmented mode control, and spacious summary panel.

Reader is a centered 720px reading column. The action chrome is a fixed top bar whose background and shadow respond to scroll state; it does not auto-hide.

Landing uses the same palette and typography at marketing scale with a 1120px content width and light screenshots as the canonical default.
