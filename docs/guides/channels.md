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
```

You need a LinkedIn developer app with the Community Management API product for
company pages (scope `w_organization_social`), or "Share on LinkedIn" for a member
(`w_member_social`). Generate a token for an admin of the page and store it as
`LINKEDIN_ACCESS_TOKEN`.

LinkedIn tokens expire (60 days by default). Put a reminder in your calendar or
automate the refresh flow; postline will fail loudly when the token stops working.

LinkedIn retires API versions roughly a year after release. postline 0.1.0 defaults
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

## Mastodon

```yaml
mastodon:
  type: mastodon
  instance: https://mastodon.social
  # visibility: public        # public | unlisted | private
```

Create an application under Preferences > Development with `write:statuses` and
`write:media`. Store the access token as `MASTODON_ACCESS_TOKEN`.

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
