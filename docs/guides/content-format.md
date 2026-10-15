# Content format

One post per Markdown file anywhere under `posts/`. Files and folders starting with
`_` or `.` are ignored, so `posts/_ideas/` is a safe place for scraps.

```markdown
---
id: launch-week-1            # optional; defaults to the file name
at: 2026-10-27 09:00         # local time in the configured timezone
status: ready                # ready (default) or draft
channels: [linkedin]         # defaults to every configured channel
topic: launch                # used by the repeat-topic check and the brief
image: ../assets/photo.jpg   # PNG or JPEG inside the project root
alt: Team photo at the offsite
card: { ... }                # see below
variants:
  bluesky: Shorter text for Bluesky.
---

The post body, exactly as it should appear.
```

## Body

Plain text. Line breaks are kept. Hashtags written as `#Word` become proper hashtags
on LinkedIn and Bluesky. Links can be full URLs or bare domains with a path
(`acme.com/blog/post`); a bare domain with no path is left as text.

`id` values are also used for safe output filenames. They must begin with a letter
or number and may contain only letters, numbers, dots, underscores and hyphens.
Unknown `status` values are errors and are treated as drafts, never as ready posts.
Rules such as hashtag and hook limits apply to the final per-channel variant.

## Cards

```yaml
card:
  layout: rows               # rows | grid | statement
  size: landscape            # optional, overrides card.size in config
  eyebrow: Case study        # small uppercase line in the accent colour
  headline:                  # 1 or 2 lines; line 2+ is in the accent colour
    - Cutting CI from 22 minutes
    - to 6 without new hardware.
  subline: Optional sentence under the headline (statement layout).
  items:                     # 2 to 4 reads best
    - title: Remote cache
      note: 71% of steps skipped
      label: Biggest win     # grid: small label above; rows: replaces the number
      chip: passing          # coloured pill, tone from brand.chips
  footer: One line at the bottom left.
```

- **rows**: numbered rows, each with an optional chip. Good for steps, lists, before/after.
- **grid**: up to four panels. Good for stats and case studies, especially in landscape.
- **statement**: headline and an optional subline. Good for questions and quotes.

Text in cards is escaped, so `<`, `&` and quotes are safe.

## Status

Drafts are ignored by `publish` and most lint rules. `postline plan` creates drafts.
A post without `at` can sit in the repo as an idea; it is never sent.
