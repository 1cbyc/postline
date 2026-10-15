# ADR-001: Content Lives in Git as Markdown Files

## Status

Accepted.

## Context

Social posts are usually written in a scheduler's web editor or a shared doc. Both
hide history, make review awkward, and lock the content into one tool. Teams that
already review code in pull requests have a better review process sitting unused.

## Decision

One post is one Markdown file. Front matter holds the time, channels, topic and
card; the body is the post text exactly as it should appear. The repo is the source
of truth for what is planned and, through the ledger (ADR-005), for what was sent.

## Consequences

Copy review, history, blame, search and rollback come from git for free. Anyone
who can edit a text file can contribute. The cost is that non-technical writers
need either a git client, GitHub's web editor, or someone to commit for them.
There is no WYSIWYG preview of the final post beyond the rendered card.

## Revisit Trigger

Revisit if most adopters are teams without anyone comfortable in git, at which point
a small web editor that commits to the repo would be worth building.
