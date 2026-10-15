# ADR-002: A TypeScript CLI with a Small Dependency Set

## Status

Accepted.

## Context

postline runs in CI on a schedule with access to social tokens. Every dependency is
code that runs with those secrets. The job itself is small: parse YAML, do date
arithmetic, render HTML, make a few HTTP calls.

## Decision

Ship a Node CLI written in TypeScript. Runtime dependencies are `yaml` and
`playwright-core`. Dates use `Intl`, HTTP uses built-in `fetch`, tests use
`node:test`, argument parsing is hand-written. Adapters receive `fetch` and `env`
as parameters so tests never hit the network.

## Consequences

Small install, small audit surface, few upgrade chores. We write a little more code
ourselves (timezone conversion, front matter splitting) and own its bugs. Node 20+
is required for `fetch`, `FormData` and `Intl.Segmenter`.

## Revisit Trigger

Revisit if a hand-rolled piece (dates, argument parsing) becomes a recurring source
of bugs that a well-maintained library would remove.
