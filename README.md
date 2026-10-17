# postline

Plan, render and publish branded social posts from a git repo.

postline treats a content calendar like code. Each post is a Markdown file with a
small block of front matter. postline checks it against your house rules, renders
an on-brand image card for it, and publishes it to LinkedIn, Bluesky, Mastodon or
any webhook when its time comes. Run its built-in daemon on your own computer or
server, use your operating system's scheduler, or opt into GitHub Actions. A
durable ledger records what went where.

<p>
  <img src="docs/images/rows-dark.png" width="32%" alt="Dark nsisong.com card: LLM output is untrusted input, with three risk rows">
  <img src="docs/images/rows-light.png" width="32%" alt="Light Nsisong Labs card: ten years of building software, three lessons">
</p>
<img src="docs/images/grid-landscape.png" width="65%" alt="Landscape Nsisong Labs card with four industry panels">

Same template, two brands: [Nsisong Labs](https://nsisonglabs.com) and [nsisong.com](https://nsisong.com). Every pixel comes from `postline.config.yaml` and the post file.

## Why

Most small teams post from someone's head and a scheduler tab. That works until
you want consistent visuals, a second person reviewing copy, a record of what went
out, or the same posts on three networks. postline gives you:

- **Posts as files.** Review copy in pull requests. Grep your history. Nothing locked in a vendor.
- **Cards from config.** Colours, font and logo live in one file. No design tool round trips for a weekly post.
- **Your design system, not ours.** Point it at your design tokens, add your own CSS, or write your own card layouts in HTML.
- **Every graphic kept.** A full-quality copy of each card is saved on your computer with a gallery to browse them later.
- **Rules that block bad posts.** Hashtag limits, banned phrases, allowed link domains, emoji policy, character limits per network, and a check for broken text encoding.
- **Boring, safe publishing.** Official APIs only. A post is sent at most once; if a run dies mid-send, postline stops and asks instead of guessing.

## Quick start

```sh
npm install --global https://github.com/1cbyc/postline/releases/download/v2026.0.1.0/postline-0.1.0.tgz
postline init my-content
cd my-content
npx playwright-core install chromium   # once, for rendering cards
postline plan                           # draft files for next week's empty slots
postline render                         # cards land in out/cards/
postline lint
postline publish --dry-run
```

To publish without GitHub Actions or usage credits, keep the project on an always-on
computer or server and run:

```sh
postline daemon --every 15
```

It checks immediately and every 15 minutes after that. See
[self-hosted scheduling](docs/guides/self-hosted-scheduling.md) for systemd and
other persistent setups. The bundled GitHub workflow remains available if you
prefer it.

## A post

```markdown
---
at: 2026-10-27 09:00
channels: [linkedin, bluesky]
topic: flaky-tests
card:
  layout: rows
  eyebrow: CI health
  headline:
    - A flaky test is a bug report
    - nobody has read yet.
  items:
    - title: checkout.spec fails 1 run in 9
      note: Same commit, different result
      chip: flaky
    - title: Quarantine with an owner and a date
      chip: passing
  footer: Track flake rate per test, not per build.
variants:
  bluesky: Shorter text for the 300 character limit.
---

A flaky test is a bug report nobody has read yet.

Most teams treat flakes as noise. Retry, get a green build, move on...

#CI #Testing
```

The body is the post. `card` describes the image. `variants` overrides the text per
channel. Full reference in [docs/guides/content-format.md](docs/guides/content-format.md).

## Design and publishing

Yes. Postline includes both the visual design system and the publishing process.

For design, it can:

- Generate branded image cards automatically.
- Apply your logo, colours, typography, spacing, footer, labels and status chips.
- Render rows, grid and statement layouts.
- Produce square, portrait or landscape images.
- Generate the final PNG or JPEG using Chromium.
- Attach that image when publishing to supported channels.

You control the appearance through `postline.config.yaml` and each post's `card`
section. For example:

```yaml
card:
  layout: rows
  eyebrow: Product update
  headline:
    - What changed this week
  items:
    - title: Faster publishing
      note: No GitHub Actions required
      chip: shipped
  footer: postline
```

Postline then handles the rest:

1. Reads the post and design instructions.
2. Checks the content and channel rules.
3. Renders the branded card.
4. Publishes the text and image at the scheduled time.
5. Records the outcome in its ledger.

### Does every post look the same?

Only if you want it to. There are three levels:

1. **Built-in layouts** (rows, grid, statement) in your colours, font and logo. Zero setup.
2. **Your design tokens and CSS.** Point `design.tokens` at the tokens file your design system already exports (W3C DTCG, Style Dictionary or plain JSON) and reference tokens in the config, e.g. `accent: "{color.brand.blue}"`. Add `design.stylesheet` to restyle the built-in layouts.
3. **Your own layouts.** Drop HTML templates into `design.templates`; `quote.html` becomes `layout: quote`. Templates use Mustache syntax and get your brand, tokens and the post's card fields, plus any extra values under `card.data`.

```yaml
design:
  tokens: design/tokens.json
  stylesheet: design/brand.css
  templates: design/templates
```

<img src="docs/images/custom-quote.png" width="32%" alt="Custom quote layout in the Nsisong Labs blue, rendered from an HTML template and design tokens">

The card above is a custom layout from [`examples/nsisonglabs/design`](examples/nsisonglabs/design):
a 27-line HTML template plus the studio's own tokens file.

Full guide: [docs/guides/design-systems.md](docs/guides/design-systems.md).

### Your graphics, kept

Every card postline renders is also saved as a lossless, 3x PNG (3600 x 3600 for a
square card) in a folder on your computer, `~/Pictures/postline/<brand>` by default,
with the post text alongside it and an `index.html` gallery. Edited cards are saved
as new versions, never overwritten. `postline library --open` opens the gallery and
`postline export <id> --scale 4` makes a one-off copy at any size.
Details: [docs/guides/graphics-library.md](docs/guides/graphics-library.md).

The important distinction is that Postline is a configurable design renderer,
not currently an AI designer. It reliably produces designs from the layouts and
brand system you define, but it does not independently invent a completely new
visual composition for every post.

### The design pipeline

```text
postline.config.yaml + post Markdown
  -> parse and validate the brand, card and channel settings
  -> lint the text, links, schedule and card content
  -> resolve design tokens and pick the built-in or custom layout
  -> combine the layout with brand colours, font, logo, chip tones and your stylesheet
  -> escape post content and embed local logo and font assets in card HTML
  -> hash the HTML and render settings, reusing an unchanged cached card
  -> open the exact square, portrait or landscape viewport in Chromium
  -> wait for the page and fonts, then capture the final PNG or JPEG
  -> save a full-quality copy and its metadata to the local graphics library
  -> upload the text and image through the selected channel adapter
  -> record the attempt and remote result in the publishing ledger
```

The generated HTML can also be kept with `postline render --html`, which makes
layout and brand adjustments easier to inspect in a browser before publishing.

## Commands

| Command | What it does |
| --- | --- |
| `postline init [dir]` | Scaffold a config, a sample post, a logo and the GitHub workflow |
| `postline plan [--week DATE]` | Create draft files for every empty slot in a week |
| `postline status [--week DATE]` | Show each slot and whether it is empty, drafted, queued or sent |
| `postline brief [--week DATE]` | Print a Markdown writing brief: open slots, rules, recent topics |
| `postline lint` | Check every post; exits non-zero on errors |
| `postline render [id] [--force] [--html] [--no-library]` | Render cards to `out/cards/` and keep full-quality copies in the library |
| `postline export <id> [--scale N] [--size S] [--format F] [--out FILE]` | Save one card at any resolution, size or format |
| `postline library [--open]` | Show the graphics library folder; `--open` opens the gallery |
| `postline layouts` | List built-in and custom layouts, tokens and stylesheet in use |
| `postline publish [--dry-run] [--now ISO] [--catch-up] [--only ID]` | Send everything that is due; CI also uses its two-phase prepare/resume flags |
| `postline daemon [--every MINUTES]` | Publish continuously on an always-on machine, without GitHub Actions |
| `postline retry <id> <channel>` | Clear a failed or stuck entry so it sends again |
| `postline mark <id> <channel> <published\|skipped>` | Record an outcome by hand |

## Channels

| Type | Notes |
| --- | --- |
| `linkedin` | Company pages or members, via the Posts API. Hashtags stay clickable. |
| `bluesky` | App password login. Links and hashtags become rich-text facets. |
| `mastodon` | Any instance. Uses an idempotency key so retries don't double post. |
| `webhook` | Signed JSON POST. Use it for Zapier, Make, n8n, Slack approvals or your own service. |
| `files` | Writes Markdown + image into a folder, e.g. your static site's blog or an archive. |

Setup for each, including tokens: [docs/guides/channels.md](docs/guides/channels.md).

## Documentation

- [Getting started](docs/guides/getting-started.md)
- [Configuration](docs/guides/configuration.md)
- [Bring your own design system](docs/guides/design-systems.md)
- [Your graphics library](docs/guides/graphics-library.md)
- [Content format](docs/guides/content-format.md)
- [Channels](docs/guides/channels.md)
- [Scheduling options](docs/guides/scheduling.md)
- [Self-hosted scheduling without GitHub Actions](docs/guides/self-hosted-scheduling.md)
- [Architecture decisions](docs/architecture/README.md)

## Examples

- [`examples/nsisonglabs`](examples/nsisonglabs): Nsisong Labs, the studio behind postline. Light theme driven by its own design tokens, a brand stylesheet and a custom `quote` layout; LinkedIn page + Bluesky + archive.
- [`examples/nsisong`](examples/nsisong): Isaac Emmanuel's personal account (nsisong.com). Dark theme, twice a week, LinkedIn as a member + a blog mirror.

Both use real brands and real content from their owners. Swap in your own config and posts.

## Development

```sh
npm install
npm test
node dist/src/cli.js render --cwd examples/nsisonglabs
```

Set `POSTLINE_CHROMIUM` to use a Chromium you already have.

## License

MIT. Built and maintained by [Isaac Emmanuel](https://nsisong.com) at [Nsisong Labs](https://nsisonglabs.com).
