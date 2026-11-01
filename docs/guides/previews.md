# Previews

See a post the way each network will show it before it goes out: locally while
you write, and on every pull request.

## postline preview

```sh
postline preview --open
```

This starts a page on `http://127.0.0.1:4400` with every post and, for each one:

- the rendered card;
- lint results;
- one panel per channel with the exact text that channel gets (including
  `variants:`), its length against that network's limit, and links and hashtags
  highlighted the way the network shows them;
- for LinkedIn, roughly where the post cuts off behind "…see more" (about 210
  characters), so the hook lands above it;
- characters past a network's limit, struck through;
- for webhooks, the JSON payload; for the files channel, the Markdown file it
  writes.

The page reloads when you save a post, the config or a design file. It only
listens on localhost. `--port` picks another port.

The network panels are close approximations, not screenshots: each network
changes its layout often, and the fold position varies with screen width.

## Pull request previews

The postline GitHub Action comments on every pull request that changes posts:
the rendered card, lengths per channel, lint results and the post text. One
comment per project, updated on every push.

Projects made with `postline init` already use it. To add it to an existing
workflow:

```yaml
on:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: write        # pushes card images to the postline-previews branch
      pull-requests: write   # comments on the pull request
    steps:
      - uses: actions/checkout@v4
      - uses: 1cbyc/postline@v0.3.2
        with:
          fail-on-error: "true"     # fail the check when a changed post has lint errors
          # working-directory: marketing   # where postline.config.yaml lives
```

How it works:

- Only posts the pull request adds or changes are shown in full. Lint errors in
  other posts are listed in one line and still fail the check with
  `fail-on-error`, because they block publishing.
- Changes are measured from where the branch left the base branch, so posts
  changed on `main` in the meantime don't show up.
- If the config, design tokens, stylesheet, a custom layout or the logo changes,
  every card may look different, so all posts are shown (the first 12 in full).
- GitHub comments can only show images from a URL, so the cards are pushed to a
  `postline-previews` branch and the comment links to them. That branch only
  holds preview images and can be deleted at any time.
- On pull requests from forks the token can't push or comment, so the report
  goes to the job summary instead.
- On private repositories GitHub may not display the images inside the comment.
  The lint results and post text still appear, and the cards are in the
  `postline-previews` branch.

The same report is available on the command line:

```sh
postline pr-report --base origin/main            # posts changed since main
postline pr-report --all --images out/pr         # every post, with rendered cards
```
