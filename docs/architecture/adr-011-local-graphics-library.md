# ADR-011: Keep a Local Graphics Library Outside the Repo

## Status

Accepted.

## Context

Rendered cards land in `out/cards/`, which is overwritten whenever a card changes,
is usually gitignored, and is sized for posting rather than reuse. People want the
graphics later at good quality: for a deck, a website, a printed handout, or simply
to see what went out. Committing large PNGs to the content repo would bloat it, and
CI runners discard their files.

## Decision

Every render also saves a lossless PNG at `library.scale` (3x by default) into a
folder on the user's computer, `~/Pictures/postline/<brand>` by default. Each image
gets a JSON sidecar with the post text, topic, layout and size, and a static
`index.html` gallery is regenerated after each change. File names end in a
fingerprint of the card's HTML and render settings, so an edited card is saved as a
new version instead of overwriting the old one, and unchanged cards are not
written again. Publishing records the channel and URL in the sidecar. Images a post
supplies itself are copied in when published. `postline export` renders any card at
another scale, size or format on demand.

The library is on by default except when the `CI` environment variable is set.
Failures to write it are warnings, never errors: rendering and publishing do not
depend on it.

## Consequences

Users keep a complete, browsable, full-resolution record of their graphics without
touching git, and it survives re-cloning the repo. The costs are disk space (a
3600 x 3600 PNG is typically 0.5 to 1 MB) and one extra screenshot per changed card
when the library scale differs from the posting scale. The library is per machine:
two people on one project each have their own, and it is not synchronised.

## Revisit Trigger

Revisit if teams ask for a shared library, which would mean syncing to object
storage or a shared drive rather than a local folder.
