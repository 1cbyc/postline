import { test } from "node:test";
import assert from "node:assert/strict";
import { lint } from "../src/lint.js";
import { config, post } from "./helpers.js";

const rules = (cfgRules: Record<string, unknown>) => config({ rules: cfgRules });

test("clean post passes", () => {
  const cfg = config();
  assert.deepEqual(lint(cfg, [post(cfg, "at: 2026-10-27 09:00\nchannels: [linkedin]")]), []);
});

test("flags hashtags, emoji, links, banned phrases and encoding", () => {
  const cfg = rules({ maxHashtags: 1, allowEmoji: false, allowedLinkDomains: ["test.example"], bannedPhrases: ["game-changer"] });
  const p = post(
    cfg,
    "at: 2026-10-27 09:00\nchannels: [linkedin]",
    "A game-changer 🚀 \u00e2\u20ac\u0153really\nsee other.com/x and test.example/ok\n#a #b",
  );
  const got = lint(cfg, [p]).map((f) => f.rule).sort();
  assert.deepEqual(got, ["banned-phrase", "emoji", "encoding", "hashtags", "link-domain"]);
});

test("enforces per-channel length and suggests a variant", () => {
  const cfg = config();
  const long = `Short hook.\n${"x".repeat(300)}`;
  const [f] = lint(cfg, [post(cfg, "at: 2026-10-27 09:00\nchannels: [bluesky]", long)]);
  assert.equal(f?.rule, "too-long");
  assert.match(f!.message, /variants\.bluesky/);
  const ok = post(cfg, `at: 2026-10-27 09:00\nchannels: [bluesky]\nvariants:\n  bluesky: short`, long);
  assert.deepEqual(lint(cfg, [ok]), []);
});

test("catches slot collisions, unknown channels and duplicate ids", () => {
  const cfg = config();
  const a = post(cfg, "id: a\nat: 2026-10-27 09:00\nchannels: [linkedin]", "x", "/x/a.md");
  const b = post(cfg, "id: b\nat: 2026-10-27 09:00\nchannels: [linkedin, x]", "x", "/x/b.md");
  const c = post(cfg, "id: a\nat: 2026-10-28 09:00\nchannels: [linkedin]", "x", "/x/c.md");
  const got = lint(cfg, [a, b, c]).map((f) => f.rule).sort();
  assert.deepEqual(got, ["duplicate-id", "slot-collision", "unknown-channel"]);
});

test("drafts are not checked for content rules", () => {
  const cfg = rules({ requireImage: true });
  assert.deepEqual(lint(cfg, [post(cfg, "status: draft", "")]), []);
});

test("warns on repeated topics inside the cooldown", () => {
  const cfg = rules({ topicCooldownDays: 7 });
  const a = post(cfg, "id: a\nat: 2026-10-27 09:00\ntopic: rag", "x", "/x/a.md");
  const b = post(cfg, "id: b\nat: 2026-10-30 09:00\ntopic: RAG", "x", "/x/b.md");
  const c = post(cfg, "id: c\nat: 2026-11-20 09:00\ntopic: rag", "x", "/x/c.md");
  const got = lint(cfg, [a, b, c]).filter((f) => f.rule === "topic-repeat");
  assert.deepEqual(got.map((f) => f.post.id), ["b"]);
});

test("requires an image when configured", () => {
  const cfg = rules({ requireImage: true });
  const [f] = lint(cfg, [post(cfg, "at: 2026-10-27 09:00")]);
  assert.equal(f?.rule, "no-image");
});
