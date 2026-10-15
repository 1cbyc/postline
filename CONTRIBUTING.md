# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

```sh
npm install
npm test
```

Rendering needs Chromium: `npx playwright-core install chromium`, or point
`POSTLINE_CHROMIUM` at one you have.

## Guidelines

- Keep runtime dependencies to what's in `package.json` today unless there's a strong reason (see `docs/architecture/adr-002`).
- New channels: one file in `src/adapters/`, take `fetch` and `env` from `AdapterDeps`, add tests with a fake `fetch`, document setup in `docs/guides/channels.md`.
- Behaviour changes that affect how posts are sent need a test in `test/publish.test.ts`.
- Bigger design changes: open an issue first, and add or update an ADR in `docs/architecture/`.
- Never include real tokens, page IDs you don't own, or customer content in tests or examples.

## Commit style

Short imperative subject (`add mastodon visibility option`), body if the why isn't obvious.
