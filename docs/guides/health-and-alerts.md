# Health checks and alerts

Most publishing failures are known in advance: a LinkedIn token that runs out,
an API version LinkedIn is about to retire, a missing secret, a post still marked
as a draft the day before it's due. `postline doctor` finds these, and alerts
tell you about anything that goes wrong while you're not watching.

## postline doctor

```sh
postline doctor
```

```text
postline 0.3.2 doctor: postline.config.yaml

✓ config       loaded postline.config.yaml
✓ posts        12 posts, no lint errors
· posts        next post: 2026-11-03-launch at Tue, Nov 3, 8:30 AM
✓ chromium     starts and can render cards
! linkedin     access token expires in 9 days (2026-11-10). Refresh it before then
✓ linkedin     LinkedIn accepted the access token
✓ bluesky      signed in to Bluesky as @acme.bsky.social
✓ ledger       31 entries, none stuck
✓ notify       sends slack alerts for failed, uncertain, blocked, doctor

0 problems, 1 warning
```

It checks:

| Area | What it checks |
| --- | --- |
| config, posts | The config loads; lint errors; drafts due in the next 48 hours; the next post |
| brand | Card colours meet WCAG AA contrast: text, muted text and chip text at 4.5:1, the accent at 3:1. Colours written as hex or `rgb()` are checked |
| chromium | Chromium starts, when any post has a card |
| each channel | Its environment variables are set, and one harmless login per network: LinkedIn and Mastodon verify the token, Bluesky signs in. Nothing is posted. Webhooks are not called, because a test request would trigger the receiver |
| LinkedIn | API version age: a warning at 10 months, an error at 12 (LinkedIn retires versions after about a year). Token expiry from `tokenExpires`: a warning 14 days ahead, an error once it has passed |
| ledger | No entry is stuck as `attempting` or `uncertain`, and none has given up after `maxAttempts` |
| lock | No lock file was left behind by a process that died |
| workflow | The GitHub workflow installs the same postline version you're running |
| notify | Alerts have somewhere to go |

`--offline` skips the network calls. `postline doctor` exits with 1 when it finds
a problem, so it works in CI and cron.

LinkedIn tokens can't be inspected, so tell postline when yours expires:

```yaml
channels:
  linkedin:
    type: linkedin
    organization: "111614509"
    tokenExpires: 2026-12-31
```

## Alerts

Add a `notify:` block and put the destination URL in an environment variable
(webhook URLs are secrets, so they stay out of the config):

```yaml
notify:
  format: slack           # slack, discord, ntfy or json
  # urlEnv: POSTLINE_NOTIFY_URL
  # on: [failed, uncertain, blocked, doctor]
```

```sh
export POSTLINE_NOTIFY_URL=https://hooks.slack.com/services/...
```

| Format | Send it to |
| --- | --- |
| `slack` | A Slack incoming webhook |
| `discord` | A Discord channel webhook |
| `ntfy` | An [ntfy](https://ntfy.sh) topic URL, for phone notifications |
| `json` | Your own endpoint. Signed with `X-Postline-Signature` when `POSTLINE_NOTIFY_SECRET` is set, the same way as the webhook channel |

Events:

- **failed**: a send failed and will be retried.
- **uncertain**: a send ended without a clear answer and may have gone out. Check the network, then `postline mark` or `postline retry`.
- **blocked**: a post is due but won't be sent (lint errors, a stuck entry, out of attempts).
- **doctor**: errors and warnings found by `postline doctor --notify` and by the
  daemon's daily check, including the 14-day token-expiry warning.

The same problem is sent at most once a day, even when it repeats on every run
(a card that won't render, a token that keeps being rejected), so a daemon
checking every 15 minutes doesn't flood the channel. If the alert can't be delivered, publishing
carries on and the failure is logged.

## Where the checks run

- **The daemon** runs doctor once a day and sends its errors and warnings as alerts.
- **GitHub Actions:** add a daily job that runs `postline doctor --notify` with
  the same secrets as the publish job.
- **cron or systemd:** `postline doctor --notify` once a day next to your publish
  timer.
