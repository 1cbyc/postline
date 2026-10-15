# ADR-007: postline Does Not Write Copy

## Status

Accepted.

## Context

Writing the posts is the hardest part of running a company page. It is tempting to
build drafting in. But voice, accuracy and what a company is allowed to claim are
specific to each business, the tools people use to write change quickly, and an
integration with any one writing service would tie the project to that vendor and
put its API keys into the publishing job.

## Decision

postline starts at a finished Markdown file. It does not generate or rewrite text.
To help whoever writes, `postline brief` produces a one-page Markdown brief for a
week: open slots, house rules and recently used topics. `postline plan` creates the
empty files to fill in. Any person or tool that can write a file can feed the
pipeline.

## Consequences

The pipeline stays vendor-neutral and the publishing job only holds social tokens.
Users bring their own writing process. Teams wanting drafting have to wire it up
themselves, but the brief gives them a clean, stable input to do it with.

## Revisit Trigger

Revisit if a clear, provider-neutral interface for drafting emerges that can run
outside the publishing job and keep its credentials separate.
