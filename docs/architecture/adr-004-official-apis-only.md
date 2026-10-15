# ADR-004: Publish Through Official APIs Only

## Status

Accepted.

## Context

Some networks make API access slow to get, so it is tempting to drive their web UI
with browser automation instead: open the composer, paste text, upload an image,
pick a date. That approach breaks whenever the UI changes, needs a logged-in browser
session on some machine, cannot be reviewed or tested in CI, and is against most
networks' terms.

## Decision

Every built-in channel uses the network's documented API with a token the user
issued. No UI automation, no scraping, no stored passwords except app-specific ones
the network provides for this purpose (Bluesky app passwords).

## Consequences

Publishing is testable with mocked HTTP, runs headless on any CI, and keeps working
across UI redesigns. Users must do one-time API setup per network, which for
LinkedIn company pages includes an app review. Networks without a usable API are
reached through the webhook channel (ADR-006) and a third-party service that holds
that integration.

## Revisit Trigger

None expected. If a network removes its API, the channel moves to webhook-only.
