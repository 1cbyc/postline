# Configuration

postline reads `postline.config.yaml` from the project root. Every key except
`brand.name` has a default.

```yaml
brand:
  name: Acme                 # required
  url: acme.com              # shown bottom-right on cards
  logo: assets/logo.svg      # SVG is inlined; PNG/JPG/WebP embedded
  showName: true             # print brand.name next to the logo
  font:
    family: Inter
    url: https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=block
    # or a local file, embedded into the card:
    # file: assets/Inter.woff2
  colors:
    background: "#0f1115"
    panel: "#161a21"         # row and panel fill
    border: "#2a303b"
    text: "#eef1f5"
    muted: "#98a1ae"         # notes, labels, footer
    accent: "#7cc4ff"        # eyebrow, second headline line, numbers, url
    ok:   ["#1f6f4a", "#7fd3a5"]   # chip [fill, text]
    warn: ["#8a5a10", "#f0c46a"]
    bad:  ["#a83a2c", "#f3907f"]
  chips:                     # chip text -> tone. Anything else is neutral.
    allowed: ok
    detected: warn
    blocked: bad

timezone: UTC                # IANA name. All `at:` values are in this zone.

schedule:
  weekStartsOn: mon          # what "a week" means for plan/status/brief
  days: [mon, tue, wed, thu, fri]
  times: ["09:00"]           # 24h

postsDir: posts
outDir: out                  # rendered cards
stateDir: .postline          # commit ledger.json; cards.json is a local render cache

card:
  size: square               # square 1200x1200, landscape 1200x627, portrait 1080x1350
  format: png                # or jpeg
  quality: 90                # jpeg only
  scale: 2                   # device pixel ratio; 2 gives crisp text

publish:
  lateMinutes: 180           # skip posts this far past their slot
  maxAttempts: 3             # stop retrying a failing channel after this
  requestTimeoutMs: 30000    # bound every external API request

design:                      # optional; see design-systems.md
  tokens: design/tokens.json   # DTCG or Style Dictionary JSON; reference as "{color.brand}"
  stylesheet: design/brand.css # extra CSS applied to every card
  templates: design/templates  # <name>.html -> card.layout: <name>

library:                     # see graphics-library.md
  enabled: true              # default true, false in CI
  dir: ~/Pictures/postline/<brand>
  scale: 3                   # full-quality copies at 3x

channels: {}                 # see channels.md

rules:
  maxHashtags: 3
  allowEmoji: true
  allowedLinkDomains: []     # empty means any domain
  hookMaxChars: 140          # first line, warning only
  requireImage: false        # every ready post needs a card or image
  topicCooldownDays: 14      # warn when a topic repeats inside this window
  bannedPhrases: []
```

## Design tokens in brand settings

With `design.tokens` set, any value under `brand.colors` (including each half of the
chip pairs) and `brand.font.family` can be a token reference such as
`"{color.brand.blue}"`. Unknown tokens stop with an error naming the token.
See [design-systems.md](design-systems.md).

## Fonts and offline rendering

With `font.url`, Chromium fetches the font while rendering, so the machine needs
network access to that host. For fully offline or locked-down CI, download the
font and use `font.file`; it is embedded into the card HTML.

## Environment variables

Secrets never go in the config file. Each channel reads its token from an
environment variable (see [channels.md](channels.md)). `POSTLINE_CHROMIUM` points
rendering at a specific Chromium binary. `NO_COLOR` turns off coloured output.

Configuration is validated before any command runs. Invalid dates, unknown status
values, unsafe post IDs, malformed URLs and out-of-range numeric settings fail
closed rather than being coerced into a publishable value.
