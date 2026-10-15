# Getting started

This walks through setting up postline for one brand and one channel, then
turning on scheduled publishing.

## 1. Create the project

```sh
npx postline init acme-content
cd acme-content
git init
```

You get:

```
postline.config.yaml      brand, schedule, channels, rules
posts/welcome.md          a sample post (status: draft)
assets/logo.svg           replace with your logo
.github/workflows/postline.yml
```

## 2. Make it look like you

Open `postline.config.yaml` and set `brand.name`, `brand.url`, the colours and the
font. Drop your logo in `assets/`. A single-colour SVG works best; use a white mark
on a dark background or a dark mark on a light one.

Render the sample to check:

```sh
npx playwright-core install chromium
npx postline render --html
```

Open `out/cards/welcome.png`. The `--html` flag also writes `welcome.html`, which
you can open in a browser while you adjust colours.

## 3. Set your schedule

```yaml
timezone: America/New_York
schedule:
  weekStartsOn: mon
  days: [mon, tue, wed, thu, fri]
  times: ["09:00", "15:00"]
```

`postline plan` creates a draft file for each empty slot in the next posting week.
`postline status` shows the week at a glance.

## 4. Write

Fill in the drafts. Remove `status: draft` when a post is ready. Run
`postline lint` as you go. `postline brief` prints the open slots, the rules and
recent topics in one page, which is useful when someone else writes the copy.

## 5. Publish

Try it locally first:

```sh
npx postline publish --dry-run --now 2026-10-27T13:05:00Z
```

Then follow [scheduling.md](scheduling.md) to let GitHub Actions send posts on time.
