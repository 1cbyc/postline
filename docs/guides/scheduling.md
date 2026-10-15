# Scheduling with GitHub Actions

postline doesn't run a server. A workflow wakes up every 15 minutes, runs
`postline publish`, and commits `.postline/ledger.json` back so the next run knows
what was already sent.

`postline init` writes `.github/workflows/postline.yml`. In short:

```yaml
on:
  schedule:
    - cron: "*/15 * * * *"
concurrency:
  group: postline-publish
  cancel-in-progress: false
permissions:
  contents: write
```

The `concurrency` block matters: it guarantees two runs never publish at once.

## Secrets

Add each token your channels use under Settings > Secrets and variables > Actions,
then make sure the workflow passes it in `env:`.

## Timing

GitHub's scheduler is best effort and can start runs several minutes late under
load. With a 15 minute cron, expect posts within roughly 5 to 20 minutes of their
slot. If you need tighter timing, run `postline publish` from any cron you control;
it is safe to run as often as you like.

Posts more than `publish.lateMinutes` (default 180) past their slot are skipped and
marked as such, so a broken workflow that comes back after a weekend doesn't fire
three days of posts in a row. Use `postline publish --catch-up` to send them anyway.

## When something fails

- **failed**: the network said no. postline retries on the next run, up to `publish.maxAttempts`. The error is in the ledger and the job log.
- **attempting**: a run started sending and died before recording the result. The post may or may not be live. Check the network. If it went out, run `postline mark <id> <channel> published --url <link>`. If it didn't, run `postline retry <id> <channel>`.
- **skipped**: too late. `postline retry` and `--catch-up` if you still want it.

## Pull requests

The same workflow runs `postline lint` on pull requests, so a post with a broken
link domain or too many hashtags can't be merged without someone noticing.

## Without GitHub

Any scheduler works: cron on a VPS, a Kubernetes CronJob, GitLab CI. Run
`postline publish` from the project directory and keep `.postline/` on disk between
runs (or commit it, as the GitHub workflow does).
