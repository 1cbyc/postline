import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError, normalizeConfig } from "../src/config.js";
import { parsePost } from "../src/content.js";
import { files } from "../src/adapters/files.js";
import { fetchWithTimeout } from "../src/adapters/types.js";
import { DEFAULT_LINKEDIN_VERSION } from "../src/adapters/linkedin.js";
import { lint } from "../src/lint.js";
import { Ledger } from "../src/ledger.js";
import { zonedToUtc } from "../src/time.js";
import { config, post, tmp } from "./helpers.js";

test("rejects malformed configuration at the boundary", () => {
  const root = tmp();
  assert.throws(
    () => normalizeConfig({ brand: { name: "x" }, schedule: { weekStartsOn: "noday" } }, root),
    (error: unknown) => error instanceof ConfigError && /weekStartsOn/.test(error.message),
  );
  assert.throws(
    () => normalizeConfig({ brand: { name: "x" }, card: { scale: 100 } }, root),
    (error: unknown) => error instanceof ConfigError && /card.scale/.test(error.message),
  );
  assert.throws(
    () => normalizeConfig({ brand: { name: "x" }, channels: { hook: { type: "webhook", url: "file:///tmp/x" } } }, root),
    (error: unknown) => error instanceof ConfigError && /HTTP or HTTPS/.test(error.message),
  );
});

test("unknown statuses fail closed as drafts and unsafe ids are parse errors", () => {
  const cfg = config();
  const parsed = parsePost("---\nid: ../escape\nstatus: drafft\nat: 2026-10-27 09:00\n---\nhello\n", join(cfg.root, "posts", "x.md"), cfg);
  assert.equal(parsed.status, "draft");
  assert.match(parsed.problems.join("\n"), /status .* is not draft or ready/);
  assert.match(parsed.problems.join("\n"), /id must start/);
});

test("file publishing rejects path traversal even when called without lint", async () => {
  const root = tmp();
  const cfg = config({ channels: { archive: { type: "files", dir: "archive" } } }, root);
  const parsed = post(cfg, "id: safe\nat: 2026-10-27 09:00\nchannels: [archive]");
  const channel = cfg.channels.archive;
  assert.equal(channel?.type, "files");
  if (!channel || channel.type !== "files") throw new Error("expected files channel");
  await assert.rejects(
    files("archive", channel, { env: {}, fetch: globalThis.fetch, root }).publish({
      post: { ...parsed, id: "../escape" },
      channel: "archive",
      text: "hello",
    }),
    /post id must start/,
  );
  assert.equal(existsSync(join(root, "escape.md")), false);
});

test("invalid calendar dates and nonexistent DST times are rejected", () => {
  assert.throws(() => zonedToUtc("2026-02-30", "09:00", "UTC"), /invalid date/);
  assert.throws(() => zonedToUtc("2026-03-08", "02:30", "America/New_York"), /invalid or nonexistent/);
});

test("lint applies hashtag limits to channel variants and contains image reads", () => {
  const cfg = config({ rules: { maxHashtags: 1 } });
  const variant = post(
    cfg,
    "at: 2026-10-27 09:00\nchannels: [bluesky]\nvariants:\n  bluesky: '#one #two'",
    "clean body",
  );
  const escapedImage = post(
    cfg,
    "id: image\nat: 2026-10-28 09:00\nchannels: [linkedin]\nimage: ../../../outside.png",
    "image body",
    join(cfg.root, "posts", "image.md"),
  );
  const findings = lint(cfg, [variant, escapedImage]);
  assert.ok(findings.some((finding) => finding.post === variant && finding.rule === "hashtags"));
  assert.ok(findings.some((finding) => finding.post === escapedImage && finding.rule === "image-path"));
});

test("external requests have a bounded timeout", async () => {
  const stalled = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
  await assert.rejects(
    fetchWithTimeout({ env: {}, fetch: stalled, root: "/", requestTimeoutMs: 10 }, "https://example.com", undefined, "test request"),
    /timed out after 10 ms/,
  );
});

test("LinkedIn defaults to the current supported API version", () => {
  assert.equal(DEFAULT_LINKEDIN_VERSION, "202609");
});

test("corrupt or structurally invalid ledgers fail closed", () => {
  const stateDir = join(tmp(), ".postline");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "ledger.json"), '{"version":1,"entries":{"p::c":{"status":"published"}}}');
  assert.throws(() => new Ledger(stateDir), /invalid updatedAt/);
});
