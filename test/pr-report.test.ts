import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, selectChanges } from "../src/pr-report.js";
import { config, post } from "./helpers.js";

function project() {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "1" }, bluesky: { type: "bluesky", maxChars: 20 } } });
  const a = post(cfg, "id: a\nat: 2026-11-05 09:00\nchannels: [linkedin, bluesky]\ncard:\n  headline: [Hello]", "A post that is too long for Bluesky", `${cfg.root}/posts/a.md`);
  const b = post(cfg, "id: b\nat: 2026-11-06 09:00\nchannels: [linkedin]", "Short.", `${cfg.root}/posts/b.md`);
  return { cfg, a, b };
}

test("only the posts a pull request touches are selected", () => {
  const { cfg, a, b } = project();
  assert.deepEqual(selectChanges(cfg, [a, b], ["posts/b.md", "README.md"]).posts.map((p) => p.id), ["b"]);
  assert.deepEqual(selectChanges(cfg, [a, b], []).posts, []);
});

test("a config change selects every post because every card may change", () => {
  const { cfg, a, b } = project();
  const changes = selectChanges({ ...cfg, file: `${cfg.root}/postline.config.yaml` }, [a, b], ["postline.config.yaml"]);
  assert.equal(changes.posts.length, 2);
  assert.match(changes.restyled ?? "", /postline.config.yaml changed/);
});

test("the report shows the card, lengths over the limit, lint errors and the text", () => {
  const { cfg, a, b } = project();
  const report = buildReport({
    cfg,
    posts: [a, b],
    changes: { posts: [a] },
    images: new Map([["a", { name: "a-1.png", url: "https://img.example/a-1.png" }]]),
    renderErrors: new Map(),
    sha: "abcdef1234567",
  });
  assert.equal(report.changed, 1);
  assert.ok(report.errors >= 1);
  assert.match(report.markdown, /<img src="https:\/\/img.example\/a-1.png" width="360" alt="Hello">/);
  assert.match(report.markdown, /\| bluesky \| \*\*35 \/ 20\*\* over \|/);
  assert.match(report.markdown, /\*\*error\*\* `too-long`/);
  assert.match(report.markdown, /<summary>Post text<\/summary>/);
  assert.match(report.markdown, /for abcdef1/);
  assert.doesNotMatch(report.markdown, /`b`/);
});

test("text containing backticks gets a longer fence", () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "1" } } });
  const p = post(cfg, "id: c\nat: 2026-11-05 09:00\nchannels: [linkedin]", "Use ```code``` blocks");
  const { markdown } = buildReport({ cfg, posts: [p], changes: { posts: [p] }, images: new Map(), renderErrors: new Map() });
  assert.match(markdown, /````text\nUse ```code``` blocks\n````/);
});

test("no changed posts says so and leaves a marker the action uses to skip commenting", () => {
  const { cfg, a } = project();
  const { markdown, changed } = buildReport({ cfg, posts: [a], changes: { posts: [] }, images: new Map(), renderErrors: new Map() });
  assert.equal(changed, 0);
  assert.match(markdown, /No posts changed/);
  assert.match(markdown, /<!-- postline-no-changes -->/);
});
