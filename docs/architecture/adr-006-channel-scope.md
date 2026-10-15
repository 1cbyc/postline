# ADR-006: Three Native Channels, a Webhook for the Rest

## Status

Accepted.

## Context

Every adapter is code to maintain against an API that changes. Some networks have
open, stable APIs (Bluesky, Mastodon). LinkedIn is the main network for B2B posts.
Others are expensive or restrictive: X charges for write access, Instagram and
Facebook require Meta app review and a business account, and Medium stopped issuing
new integration tokens.

## Decision

Ship native adapters for LinkedIn, Bluesky and Mastodon. Ship a signed webhook
channel so any automation service or custom endpoint can carry posts elsewhere, and
a files channel that writes Markdown for static sites and archives. Adapters share
one small interface: take text and an optional image, return an id and URL.

## Consequences

The core stays small and every built-in channel can be fully tested. Users who need
Instagram, X or Threads use Zapier, Make, n8n or their own service through the
webhook, which also covers approval flows. Adding a native adapter later is one file.

## Revisit Trigger

Add a native adapter when a network has a stable public API and enough users ask
for it that the webhook detour is a real burden.
