# ADR-012: Unclear Send Results Are Never Retried Automatically

## Status

Accepted. Refines ADR-005.

## Context

ADR-005 retried every `failed` delivery up to `publish.maxAttempts`. But some
failures happen after the network has already accepted the post: a timeout while
waiting for the response, a dropped connection, a 5xx from a proxy in front of a
service that did its work, or a 2xx we cannot read. LinkedIn has no idempotency key,
so retrying those could post twice, which ADR-005 says is worse than posting late.

A daemon and a manual `postline publish` on the same machine could also each load
the ledger, miss the other's `attempting` entry and send the same post.

## Decision

Adapters wrap the single request that makes a post public in `deliver()`. A 4xx
from that request is a clear rejection and stays `failed`. Anything else becomes a
`DeliveryUncertainError`, recorded as `uncertain` in the ledger. Like `attempting`,
an `uncertain` entry blocks publishing until a person runs `postline mark` or
`postline retry`. Failures before that request (login, uploads, rendering the card)
did not publish anything and stay retryable. Cards are rendered before the entry is
marked `attempting`, so a render failure does not use up an attempt.

Where a network lets us make retries safe, we do instead:

- **Bluesky**: the record key is a TID derived from the post's scheduled time and a
  hash of its id and channel. Before creating, postline looks the key up; if a
  record with the same text exists, the earlier attempt succeeded and is recorded.
- **Mastodon**: the `Idempotency-Key` header, as before.

LinkedIn and webhooks use `deliver()`.

Commands that write the ledger (`publish`, `daemon` checks, `retry`, `mark`) hold an
exclusive `publish.lock` in the state directory and read the ledger only after
taking it. A lock left by a dead process on the same host is taken over. The ledger
file and its directory are fsynced before and after the atomic rename.

## Consequences

An unclear LinkedIn or webhook result now needs a person, where before it was retried
silently. That is a few more manual checks in exchange for no silent duplicates.
Bluesky record keys encode the scheduled time rather than the send time; Bluesky
orders feeds by `createdAt`, which is still the real send time.

## Revisit Trigger

Revisit if LinkedIn adds an idempotency key or a way to look up a post by a client
token, or if Bluesky stops accepting client-chosen TIDs for posts.
