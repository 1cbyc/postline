import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildReport, gitChanges, selectChanges } from "../src/pr-report.js";
import { config, post, tmp } from "./helpers.js";

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
  const { cfg, b } = project();
  const { markdown, changed } = buildReport({ cfg, posts: [b], changes: { posts: [] }, images: new Map(), renderErrors: new Map() });
  assert.equal(changed, 0);
  assert.match(markdown, /No posts changed/);
  assert.match(markdown, /<!-- postline-no-changes -->/);
});

test("lint errors in posts the pull request didn't change are counted separately", () => {
  const { cfg, a, b } = project();
  const report = buildReport({ cfg, posts: [a, b], changes: { posts: [b] }, images: new Map(), renderErrors: new Map() });
  assert.equal(report.errors, 0);
  assert.ok(report.otherErrors >= 1);
  assert.match(report.markdown, /in posts this pull request didn't change \(`a`\)/);
  const none = buildReport({ cfg, posts: [a, b], changes: { posts: [] }, images: new Map(), renderErrors: new Map() });
  assert.doesNotMatch(none.markdown, /postline-no-changes/);
});

test("changes are measured from the merge base, not the base branch's tip", () => {
  const root = tmp();
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  mkdirSync(join(root, "posts"));
  writeFileSync(join(root, "posts", "old.md"), "old\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  writeFileSync(join(root, "posts", "mine é.md"), "mine\n");
  git("add", ".");
  git("commit", "-qm", "feature");
  git("checkout", "-q", "main");
  writeFileSync(join(root, "posts", "theirs.md"), "theirs\n");
  git("add", ".");
  git("commit", "-qm", "main moved on");
  git("checkout", "-q", "feature");
  assert.deepEqual(gitChanges(root, "main"), ["posts/mine é.md"]);
});
