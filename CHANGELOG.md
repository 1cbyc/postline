# Changelog

## 0.2.2

A website, and a clearer license.

- postline now has a website with the full guides: https://postline.nsisong.com
- License 1.2 says plainly what was intended: anyone may install and run postline, including commercially, edit the files `postline init` creates, and keep everything postline produces. Copying, modifying or redistributing the code, offering it as a hosted service, and AI training still need written permission

## 0.2.1

Safer delivery.

- A send that ends without a clear answer (timeout, dropped connection, 5xx, or LinkedIn accepting a post without returning its id) is now recorded as `uncertain` and never retried automatically; previously it was `failed` and retried, which could post twice
- Bluesky posts use a fixed record key per post, and postline looks it up before posting, so retries can't create a duplicate
- Webhook timeouts and 5xx responses are `uncertain` too; 4xx responses are still retried
- `publish`, daemon checks, `retry` and `mark` hold `.postline/publish.lock`, so two processes on one project can't send the same post
- A card that fails to render no longer uses up a publish attempt
- The ledger is flushed to disk before it replaces the old one
- `postline init` pins the generated GitHub workflow to its own version and installs it from npm; the workflow no longer adds a maintainer `Co-authored-by` line to your ledger commits
- Install from npm: `npm install --global postline`
- New license: the Nsisong Source-Available License 1.1 (see `LICENSE`). Earlier grants are preserved in `LICENSE.previous`

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
