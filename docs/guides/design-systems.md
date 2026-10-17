# Bring your own design system

postline ships three layouts (rows, grid, statement) that take your colours, font
and logo. When that isn't enough, you can bring your own design system in three
steps, each optional and independent:

1. **Tokens**: point postline at your design tokens file and reference tokens from the config.
2. **A stylesheet**: CSS that is applied on top of every card.
3. **Custom layouts**: your own HTML templates, used like the built-in ones.

```yaml
design:
  tokens: design/tokens.json
  stylesheet: design/brand.css
  templates: design/templates     # quote.html becomes `layout: quote`
```

All three paths must be inside the project. `postline layouts` shows what was found.
A full working setup lives in [`examples/nsisonglabs`](../../examples/nsisonglabs).

## 1. Tokens

postline reads design tokens in any of these JSON shapes:

- **W3C Design Tokens (DTCG)**: `{"color": {"blue": {"$type": "color", "$value": "#1034a6"}}}`. This is what Tokens Studio, Figma variable exporters and most current tools produce.
- **Style Dictionary**: `{"color": {"blue": {"value": "#1034a6"}}}`.
- **Plain nested values**: `{"color": {"blue": "#1034a6"}}`.

Aliases such as `"{color.blue}"` are followed, and cycles or missing tokens are
reported with the token's name. Keys starting with `$` (descriptions, types) are ignored.

### Use tokens in the config

Any brand colour, chip colour or the font family can be a token reference:

```yaml
brand:
  font:
    family: "{font.family}"
  colors:
    background: "{color.surface.page}"
    accent: "{color.brand.blue}"
    ok: ["{color.status.ok.fill}", "{color.status.ok.text}"]
```

Change a value in `tokens.json` and every card picks it up on the next render.

### Use tokens in CSS

Every token is also available as a CSS custom property on every card, built-in or
custom. Dots and other separators become dashes:

| Token | CSS |
| --- | --- |
| `color.brand.blue` | `var(--color-brand-blue)` |
| `radius.card` | `var(--radius-card)` |

Values that contain anything other than ordinary CSS value characters are left out
of the CSS, so a token file can't inject rules.

## 2. A stylesheet

`design.stylesheet` is inlined after postline's own CSS, so it wins. Use it to adjust
the built-in layouts without writing templates:

```css
.row, .panel { border-radius: var(--radius-card); }
.eyebrow { letter-spacing: 0.22em; }
h1 em { color: var(--color-brand-blue); }
```

Useful classes in the built-in layouts: `.card`, `.logo`, `.eyebrow`, `h1`, `h1 em`
(the accent lines), `.subline`, `.rows`, `.row`, `.num`, `.grid`, `.panel`, `.label`,
`.title`, `.note`, `.chip` (plus `.ok`, `.warn`, `.bad`, `.neutral`) and `footer`.
Run `postline render <id> --html` to get the exact HTML to inspect in a browser.

## 3. Custom layouts

Every `<name>.html` in `design.templates` becomes a layout called `<name>`
(lowercase letters, numbers and hyphens). A template named `rows.html`, `grid.html`
or `statement.html` replaces the built-in one.

```markdown
---
at: 2026-11-09 09:00
card:
  layout: quote
  headline:
    - Reputation compounds
    - faster than revenue.
  data:
    author: Isaac Emmanuel
    role: Founder, Nsisong Labs
---
```

Templates use [Mustache](https://mustache.github.io/mustache.5.html) syntax:

| Syntax | Meaning |
| --- | --- |
| `{{card.footer}}` | Insert a value, HTML-escaped |
| `{{{brand.logo}}}` | Insert without escaping (only for values you trust) |
| `{{#card.items}}...{{/card.items}}` | Repeat for each item, or show if the value is set |
| `{{^card.subline}}...{{/card.subline}}` | Show only if the value is empty or missing |
| `{{.}}` | The current item inside a list of plain values |
| `{{! note }}` | A comment |

You don't need `<html>`, `<head>` or a charset. postline wraps the template and
always injects, in this order: `<meta charset="utf-8">`, your font, the brand
variables (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--accent`,
`--ok`/`--ok-bg`, `--warn`/`--warn-bg`, `--bad`/`--bad-bg`, `--font`), a small
reset that sizes `body` to the card, your tokens and your stylesheet. If the
template has its own `<head>`, they are added at the top of it.

### What a template can use

| Name | Value |
| --- | --- |
| `brand.name`, `brand.url`, `brand.urlText` | Brand name, URL, URL without `https://` |
| `brand.logo` | The logo as a data URI, for `<img src="{{brand.logo}}">` |
| `brand.font.family` | Font family name |
| `colors.background` ... `colors.accent` | Brand colours |
| `colors.ok.fill`, `colors.ok.text` (and `warn`, `bad`) | Chip colours |
| `tokens.*` | Every design token, e.g. `{{tokens.color.brand.blue}}` |
| `card.layout`, `card.eyebrow`, `card.subline`, `card.footer` | From the post |
| `card.headline` | All headline lines (a list) |
| `card.headlineFirst`, `card.headlineRest`, `card.headlineText` | First line, the remaining lines, all lines joined |
| `card.items` | Each item has `title`, `note`, `label`, `chip`, `tone` (`ok`, `warn`, `bad` or `neutral`), `number` (1-based), `index`, `first`, `last` |
| `card.hasItems` | True when there are items |
| `data.*` | Anything under `card.data` in the post: text, numbers, lists, mappings |
| `size.name`, `size.width`, `size.height` | Card size in CSS pixels (1200 wide for square and landscape) |
| `size.square`, `size.landscape`, `size.portrait` | True for the current size, for size-specific CSS |

Design at the CSS pixel sizes (1200 x 1200, 1200 x 627, 1080 x 1350). postline
renders at a higher pixel density, so text stays sharp.

### Tips

- Start by copying `examples/nsisonglabs/design/templates/quote.html`.
- `postline render <id> --html --force` writes the generated HTML next to the PNG so you can open it in a browser and use the developer tools.
- For custom layouts, `card.headline` is optional, so templates can be driven entirely by `card.data`.
- Fonts referenced by `@font-face` in your stylesheet must be reachable when rendering. For offline rendering, use `brand.font.file`.
