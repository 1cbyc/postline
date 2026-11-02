# Channels

Channels are named in the config. The name is what posts reference in `channels:`;
`type` picks the adapter. You can have two channels of the same type, for example
two LinkedIn pages.

```yaml
channels:
  linkedin:
    type: linkedin
    organization: "111614509"
  founder:
    type: linkedin
    person: "abc123"
    tokenEnv: FOUNDER_LINKEDIN_TOKEN
```

Every channel accepts `maxChars` to override its length limit.

## LinkedIn

```yaml
linkedin:
  type: linkedin
  organization: "111614509"   # the number in linkedin.com/company/<id>/admin
  # person: "<member id>"     # post as a member instead
  # version: "202609"         # LinkedIn-Version header (YYYYMM)
  # tokenEnv: LINKEDIN_ACCESS_TOKEN
  # tokenExpires: 2026-12-31  # when the token stops working; doctor warns 14 days ahead
```

You need a LinkedIn developer app with the Community Management API product for
company pages (scope `w_organization_social`), or "Share on LinkedIn" for a member
(`w_member_social`). Generate a token for an admin of the page and store it as
`LINKEDIN_ACCESS_TOKEN`.

LinkedIn tokens expire (60 days by default) and can't be inspected, so tell
postline when yours runs out with `tokenExpires:`. `postline doctor` then warns
14 days ahead, and with alerts configured the daemon tells you on its daily check.
See [health checks and alerts](health-and-alerts.md).

LinkedIn retires API versions roughly a year after release; `postline doctor`
warns when the configured version is 10 months old. postline defaults
to the September 2026 API (`202609`). Check [LinkedIn's versioning page](https://learn.microsoft.com/en-us/linkedin/marketing/versioning)
before each postline release and update `version:` when migrating deliberately.

## Bluesky

```yaml
bluesky:
  type: bluesky
  # service: https://bsky.social
  # lang: en
```

Create an app password under Settings > Privacy and security > App passwords.
Set `BLUESKY_IDENTIFIER` (your handle) and `BLUESKY_APP_PASSWORD`.

Bluesky posts are limited to 300 characters, so most posts need a `variants.bluesky`.
Images must be under 1 MB; if your PNG cards are larger, use `card.format: jpeg`.

Each post gets a fixed record key built from its id, channel and scheduled time.
Before posting, postline checks whether a record with that key already exists, so
a retry after a timeout finds the first post instead of creating a second one. If
it finds a record with different text (you edited the post after a lost attempt),
it stops and asks you to check the account.

## Mastodon

```yaml
mastodon:
  type: mastodon
  instance: https://mastodon.social
  # visibility: public        # public | unlisted | private
```

Create an application under Preferences > Development with `write:statuses` and
`write:media`. Store the access token as `MASTODON_ACCESS_TOKEN`.

Every status carries an `Idempotency-Key`, so a retry can't create a second
status, even after a timeout or a 5xx. Mastodon remembers keys for about an hour,
so postline only retries an unclear failure within 50 minutes of the first
attempt. After that it records the post as `uncertain` and asks you to check,
rather than risk a duplicate.

## Webhook

```yaml
instagram:
  type: webhook
  url: https://hooks.zapier.com/hooks/catch/...
  # secretEnv: POSTLINE_WEBHOOK_SECRET
```

postline POSTs:

```json
{
  "delivery": "post-id::channel",
  "id": "post-id",
  "channel": "instagram",
  "at": "2026-10-27T13:00:00.000Z",
  "topic": "launch",
  "text": "...",
  "image": { "mime": "image/png", "alt": "...", "base64": "..." }
}
```

Headers: `X-Postline-Delivery` (stable, use it to de-duplicate) and, when the secret
is set, `X-Postline-Signature: sha256=<hex HMAC of the raw body>`. Any 2xx counts
as success. If the response is JSON with `id` or `url`, those are recorded.

A 4xx is retried on the next run. A timeout, dropped connection or 5xx is recorded
as `uncertain` and not retried, because your receiver may already have acted on it.
Check it, then run `postline mark` or `postline retry`.

Use this for networks postline doesn't cover directly (Instagram, Facebook, X,
Threads, TikTok) through Zapier, Make or n8n, or to route posts into a Slack
approval step.

## Files

```yaml
blog:
  type: files
  dir: ../website/src/content/social
  assetsDir: ../website/public/social
  assetsUrl: /social
```

Writes `<id>.md` with `title`, `date`, `topic`, `image` and `imageAlt` front matter,
plus the image. Useful for mirroring posts onto a static site or keeping an archive.
