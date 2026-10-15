# ADR-005: Stateless Scheduler, Committed Ledger, At-Most-Once Delivery

## Status

Accepted.

## Context

LinkedIn's API has no native scheduled publishing, and we do not want to run a
server. Something must wake up, find due posts and send them exactly when they are
due. A post sent twice is visibly worse than a post sent late: it looks careless and
cannot be cleanly undone.

## Decision

`postline publish` is a one-shot command meant to run from cron (GitHub Actions
every 15 minutes by default, with a concurrency group). Delivery state lives in
`.postline/ledger.json`, keyed by post id and channel, and is committed back to the
repo after each run.

Before calling a network, the entry is written as `attempting` and saved. After the
call it becomes `published` or `failed`. A run that finds an `attempting` entry does
not retry it; a human checks the network and runs `postline mark` or
`postline retry`. Failed calls retry on later runs up to `publish.maxAttempts`.
Posts more than `publish.lateMinutes` past due are skipped unless `--catch-up`.
Mastodon calls also carry an idempotency key.

## Consequences

No server, no database, history is reviewable in git, and a crash can never cause a
silent double post. The costs: timing is only as good as the cron (GitHub can lag
several minutes), and a crash mid-send needs a person to resolve one entry. The
ledger commit adds a small commit per run that sends something.

## Revisit Trigger

Revisit if users need minute-accurate timing or run many brands from one repo,
where a long-running worker or a hosted scheduler would serve better.
