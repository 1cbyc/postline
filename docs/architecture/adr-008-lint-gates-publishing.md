# ADR-008: Lint Gates Publishing

## Status

Accepted.

## Context

Mistakes in posts are public and hard to take back: a link to the wrong domain, a
post too long for one network, a banned phrase, or text whose encoding broke
somewhere between editor and repo (curly quotes turning into sequences like `â€œ`).
Review catches some of this; people miss the rest.

## Decision

`postline lint` checks every post against the rules in the config and against
per-network limits. The same checks run inside `publish`: a post with any lint
error is not sent, and the run reports it. Warnings (long hook, repeated topic,
crowded card) never block. The bundled workflow runs lint on pull requests.

Encoding is checked explicitly by looking for the byte patterns UTF-8 produces when
decoded as Latin-1 or Windows-1252.

## Consequences

Broken posts stop before they go out instead of after. Rules are explicit and
reviewable in the config. A post blocked at publish time misses its slot until
someone fixes it, which is the intended trade-off.

## Revisit Trigger

Revisit if rules need to vary per channel or per post often enough that a single
rule set gets in the way.
