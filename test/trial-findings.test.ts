// Regressions found by running postline end to end for a real brand (GitHub, with Primer tokens).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lint } from "../src/lint.js";
import { tokenCss } from "../src/design.js";
import { Ledger } from "../src/ledger.js";
import { publishDue } from "../src/publish.js";
import { config, post } from "./helpers.js";

test("drafts from postline plan are reminders, but a mistyped status is still an error", () => {
  const cfg = config();
  const draft = post(cfg, "id: d1\nat: 2026-11-11 10:00\nstatus: draft\nchannels: [linkedin]\ncard:\n  headline: [x]\n  items:\n    - title:\n      note:");
  const typo = post(cfg, "id: d2\nat: 2026-11-12 10:00\nstatus: redy\nchannels: [linkedin]");
  const findings = lint(cfg, [draft, typo]);
  assert.ok(findings.filter((f) => f.post === draft).every((f) => f.severity === "warn"));
  assert.ok(findings.some((f) => f.post === typo && f.severity === "error" && /redy/.test(f.message)));
});

test("token CSS variables keep the token's own spelling as well as lowercase", () => {
  const css = tokenCss(new Map([["fgColor-default", "#1f2328"], ["color.brand.blue", "#1034a6"]]));
  assert.match(css, /--fgColor-default:#1f2328;/);
  assert.match(css, /--fgcolor-default:#1f2328;/);
  assert.match(css, /--color-brand-blue:#1034a6;/);
  assert.equal(css.match(/--color-brand-blue:/g)?.length, 1);
});

test("the same problem on several channels is reported once", () => {
  const cfg = config({
    channels: { linkedin: { type: "linkedin", organization: "1" }, hook: { type: "webhook", url: "https://hooks.example/x" } },
    rules: { maxHashtags: 2 },
  });
  const p = post(cfg, "id: p1\nat: 2026-11-05 10:00\nchannels: [linkedin, hook]", "Hello #a #b #c");
  const hashtags = lint(cfg, [p]).filter((f) => f.rule === "hashtags");
  assert.equal(hashtags.length, 1);
  assert.match(hashtags[0]!.message, /^linkedin, hook: 3 hashtags/);
});

test("a failure message doesn't repeat the channel name", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "1" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]");
  const lines: string[] = [];
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), {
    now: new Date("2026-10-27T13:05:00Z"),
    dryRun: false,
    catchUp: false,
    deps: { env: {}, fetch: globalThis.fetch, root: "/" },
    renderer: () => {
      throw new Error("no renderer");
    },
    log: (l) => lines.push(l),
  });
  assert.equal(out[0]?.detail, "environment variable LINKEDIN_ACCESS_TOKEN is not set");
  assert.equal(lines[0], "x p1 -> linkedin: environment variable LINKEDIN_ACCESS_TOKEN is not set");
});

test("a post that has used up its attempts says so, instead of exiting silently", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "1" } }, publish: { maxAttempts: 1 } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]");
  const ledger = new Ledger(cfg.stateDir);
  ledger.set("p1", "linkedin", { status: "failed", error: "linkedin: HTTP 400", attempts: 1 });
  const lines: string[] = [];
  const out = await publishDue(cfg, [p], ledger, {
    now: new Date("2026-10-27T13:05:00Z"),
    dryRun: false,
    catchUp: false,
    deps: { env: {}, fetch: globalThis.fetch, root: "/" },
    renderer: () => {
      throw new Error("no renderer");
    },
    log: (l) => lines.push(l),
  });
  assert.deepEqual(out.map((o) => o.result), ["blocked"]);
  assert.match(lines[0] ?? "", /gave up after 1 attempts \(HTTP 400\); fix it, then run "postline retry p1 linkedin"/);
});
