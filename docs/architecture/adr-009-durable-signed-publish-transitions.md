# ADR-009: Persist Signed Delivery Intent Before Network Calls

## Status

Accepted.

## Context

Writing `attempting` to a runner's local ledger before a network call is not enough
when the runner is disposable. If it crashes during the call, the local state is
lost and the next run can send the same post again. Committing only after the
publish command exits therefore cannot provide the at-most-once behavior described
in ADR-005.

The repository also treats its history as an audit record. Automated ledger commits
must meet the same signature requirements as human release commits.

## Decision

The bundled workflow publishes in two explicit phases:

1. `publish --prepare-only` records every eligible delivery as `attempting` without
   making a network call. The workflow signs, verifies and pushes that ledger commit.
2. `publish --resume-prepared` sends only those durable `attempting` entries and
   records each final outcome. The workflow signs, verifies and pushes the result.

The workflow refuses to begin phase one without its dedicated GPG key and Git
identity. It stages only `.postline/ledger.json`, verifies every commit locally,
and stops if the prepared state cannot be pushed.

## Consequences

A crash before the first push sends nothing. A crash after the first push leaves an
`attempting` entry, so the next run blocks until a person checks the network. A
crash after the network accepts a post but before the final push cannot cause an
automatic duplicate. The trade-off is two small commits for a run that publishes,
plus one-time signing-key setup for scheduled workflows.

Persistent local schedulers may keep using the one-step `publish` command because
the ledger is durable between processes.

## Revisit Trigger

Revisit if every supported channel offers a stable provider idempotency key, or if
postline adopts a transactional remote state store that can replace Git as the
delivery ledger.
