# Changelog

## 0.2.0

Bring your own design system, and keep every graphic.

- `design.tokens`: read design tokens (W3C DTCG, Style Dictionary or plain JSON) and reference them from brand settings as `"{color.brand.blue}"`; every token is also a CSS variable on every card
- `design.stylesheet`: your own CSS applied on top of every card
- `design.templates`: custom card layouts as HTML templates (Mustache syntax), with free-form `card.data` in posts; a template can also replace a built-in layout
- Local graphics library: every rendered card is saved as a lossless 3x PNG with a JSON sidecar and an `index.html` gallery, in `~/Pictures/postline/<brand>` by default; edited cards are kept as new versions, and publishing records where each card went
- `postline export` renders any card at another scale, size or format
- `postline library [--open]` and `postline layouts`
- `render --no-library`
- Nsisong Labs example now uses tokens, a stylesheet and a custom `quote` layout

## 0.1.0

First release.

- `init`, `plan`, `status`, `brief`, `lint`, `render`, `publish`, `retry`, `mark`
- Card layouts: rows, grid, statement; square, landscape and portrait sizes
- Channels: LinkedIn, Bluesky, Mastodon, webhook, files
- Ledger with at-most-once delivery and late-post skipping
- Built-in `daemon` for scheduling without GitHub Actions or usage credits
- GitHub Actions and systemd workflow templates
