# ADR-013: Pull Request Previews Push Images to a Branch; Alerts Are Deduplicated

## Status

Accepted.

## Context

Reviewing a post in a pull request means reading Markdown and imagining the card.
A comment with the rendered card, lengths per channel and lint results makes
review concrete. GitHub comments can only show images from a URL, and the API has
no way to attach files to a comment.

Publishing failures were only visible in logs. People need to hear about them,
and about problems that will cause failures (an expiring LinkedIn token), without
being flooded by a daemon that checks every 15 minutes.

## Decision

**Previews.** `action.yml` at the repository root is a composite action. It builds
postline from the action's own source, renders the changed posts' cards with
`postline pr-report`, pushes the images to an orphan `postline-previews` branch
under `pr-<number>/<project>/`, and creates or updates one comment per project,
found by a hidden marker. Fork pull requests get the report in the job summary,
because their token is read-only. The action never needs publishing secrets.

**Alerts.** `notify:` sends one message per run for `failed`, `uncertain` and
`blocked` outcomes and for doctor errors. Each alert has a key; the same key is
sent at most once per 24 hours (`.postline/notified.json`). Delivery failures are
logged and never stop publishing. The destination URL comes from an environment
variable by default, because chat webhook URLs are secrets.

**Doctor.** Network checks make one read-only or login request per channel and
never post. Webhooks are not called. LinkedIn tokens can't be inspected, so
expiry comes from a `tokenExpires` date in the config.

## Consequences

Reviewers see the card in the pull request. The repository gains a branch of
preview images that grows over time and can be deleted whenever. On private
repositories GitHub may not show the images in the comment. A real outage alerts
once a day until fixed, which is a reminder rather than noise.

## Revisit Trigger

Revisit if GitHub adds an API for comment attachments, or if preview images should
go to object storage (R2, S3) instead of the repository.
