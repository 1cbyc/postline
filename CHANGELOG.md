# Changelog

## 0.3.0

See it before it ships, and hear about problems before a post fails.

- `postline preview`: a local page per post with the card, lint results and each channel's text the way that network will show it: length against the limit, highlighted links and hashtags, where LinkedIn folds behind "see more", the webhook payload and the files channel's Markdown. Reloads on save
- Pull request previews: a GitHub Action (`uses: 1cbyc/postline@v0.3.0`) that comments the changed posts' rendered cards, per-channel lengths and lint results on pull requests that change posts, kept up to date on every push. Lint errors in other posts still fail the check. `postline init` workflows use it. `postline pr-report` produces the same report locally
- `postline doctor`: checks the config, lint, drafts due soon, Chromium, each channel's secrets and login, LinkedIn API version age and token expiry, stuck ledger entries, stale locks and the workflow's postline version
- Alerts: `notify:` sends failed, uncertain and blocked sends and doctor errors and warnings to Slack, Discord, ntfy or a signed JSON endpoint, at most once a day per problem, even when it repeats every run
- The daemon runs doctor once a day, even when publishing fails, and sends its errors and warnings, including the 14-day token-expiry warning
- LinkedIn channels accept `tokenExpires:` so doctor can warn 14 days before the token stops working

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
