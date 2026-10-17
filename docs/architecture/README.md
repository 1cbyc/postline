# Architecture decisions

Short records of the decisions that shape postline. Each one says what we chose,
what it costs, and what would make us change it. New decisions get the next number;
superseded ones stay, marked as such.

| ADR | Decision |
| --- | --- |
| [001](adr-001-content-lives-in-git.md) | Content lives in git as Markdown files |
| [002](adr-002-typescript-cli-small-dependency-set.md) | A TypeScript CLI with a small dependency set |
| [003](adr-003-cards-rendered-from-html.md) | Cards are HTML rendered by headless Chromium |
| [004](adr-004-official-apis-only.md) | Publish through official APIs only |
| [005](adr-005-stateless-scheduler-committed-ledger.md) | Stateless scheduler, committed ledger, at-most-once delivery |
| [006](adr-006-channel-scope.md) | Three native channels, a webhook for the rest |
| [007](adr-007-postline-does-not-write-copy.md) | postline does not write copy |
| [008](adr-008-lint-gates-publishing.md) | Lint gates publishing |
| [009](adr-009-durable-signed-publish-transitions.md) | Persist signed delivery intent before network calls |
| [010](adr-010-bring-your-own-design-system.md) | Bring your own design system: tokens, stylesheet, templates |
| [011](adr-011-local-graphics-library.md) | Keep a local graphics library outside the repo |

## Format

```
# ADR-NNN: Title
## Status
## Context
## Decision
## Consequences
## Revisit Trigger
```
