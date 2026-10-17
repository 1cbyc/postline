# ADR-003: Cards Are HTML Rendered by Headless Chromium

## Status

Accepted. Extended by ADR-010 (custom templates and design tokens).

## Context

Posts with a consistent, branded image perform better and look like they come from
the same company. Making one per post in a design tool does not scale to several
posts a day. Canvas or SVG drawing libraries make text layout (wrapping, kerning,
web fonts) hard. Browser text rendering already solves all of that.

## Decision

Build each card as a self-contained HTML page from the brand config and the post's
`card` block, then screenshot it with headless Chromium through `playwright-core`.
Three layouts cover most posts: rows, grid and statement. All text is HTML-escaped
and the page declares UTF-8. Image and SVG assets are embedded as non-executable
data URLs. Renders are cached by a hash of the HTML.

## Consequences

Cards look sharp, wrap correctly and use real brand fonts. Brands change the look by
editing colours, not templates. The cost is a Chromium download (about 100 MB) in
CI and slower renders than a pure image library, roughly a second per card.
Layouts are deliberately limited; heavy custom design still needs a design tool and
the `image:` field.

## Revisit Trigger

Revisit if Chromium becomes the main install complaint or if many adopters need
layouts beyond the three, in which case user-supplied HTML templates are the next step.
