import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { doctorAlerts, linkedInVersionAge, runDoctor, type Check } from "../src/doctor.js";
import { Ledger } from "../src/ledger.js";
import { ConfigError } from "../src/config.js";
import { config, post } from "./helpers.js";

const NOW = new Date("2026-11-01T12:00:00Z");

function find(checks: Check[], area: string, pattern: RegExp): Check | undefined {
  return checks.find((c) => c.area === area && pattern.test(c.message));
}

test("LinkedIn version age is counted in whole months", () => {
  assert.equal(linkedInVersionAge("202609", NOW), 2);
  assert.equal(linkedInVersionAge("202511", NOW), 12);
});

test("tokenExpires must be a real date; YAML dates are accepted", () => {
  assert.throws(() => config({ channels: { linkedin: { type: "linkedin", organization: "1", tokenExpires: "next week" } } }), ConfigError);
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "1", tokenExpires: new Date("2026-12-31T00:00:00Z") } } });
  const ch = cfg.channels.linkedin;
  assert.equal(ch?.type === "linkedin" ? ch.tokenExpires : undefined, "2026-12-31");
});

test("doctor flags expiring and expired LinkedIn tokens, old API versions and missing env", async () => {
  const run = async (tokenExpires: string, version = "202609", env: NodeJS.ProcessEnv = { LINKEDIN_ACCESS_TOKEN: "t" }) => {
    const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "1", tokenExpires, version } } });
    const p = post(cfg, "id: p1\nat: 2026-11-05 09:00\nchannels: [linkedin]");
    return runDoctor({ cfg, posts: [p], now: NOW, env, version: "0.3.0" });
  };
  assert.equal(find(await run("2026-11-10"), "linkedin", /expires in 8 days/)?.level, "warn");
  assert.equal(find(await run("2026-10-30"), "linkedin", /expired on 2026-10-30/)?.level, "error");
  assert.equal(find(await run("2027-01-15"), "linkedin", /valid until/)?.level, "ok");
  assert.equal(find(await run("2027-01-15", "202512"), "linkedin", /will be retired soon/)?.level, "warn");
  assert.equal(find(await run("2027-01-15", "202510"), "linkedin", /retires versions/)?.level, "error");
  assert.equal(find(await run("2027-01-15", "202609", {}), "linkedin", /LINKEDIN_ACCESS_TOKEN is not set/)?.level, "error");
});

test("doctor checks each network's login without posting", async () => {
  const cfg = config({
    channels: {
      linkedin: { type: "linkedin", organization: "1", tokenExpires: "2027-01-01" },
      bluesky: { type: "bluesky" },
      mastodon: { type: "mastodon", instance: "https://social.example" },
      hook: { type: "webhook", url: "https://hooks.example/x" },
    },
  });
  const p = post(cfg, "id: p1\nat: 2026-11-05 09:00\nchannels: [linkedin, bluesky, mastodon, hook]");
  const calls: { url: string; method: string }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("linkedin")) return new Response("", { status: 401 });
    if (url.includes("createSession")) return Response.json({ handle: "me.example" });
    return Response.json({ acct: "me" });
  }) as unknown as typeof fetch;
  const env = { LINKEDIN_ACCESS_TOKEN: "t", BLUESKY_IDENTIFIER: "me", BLUESKY_APP_PASSWORD: "pw", MASTODON_ACCESS_TOKEN: "m" };
  const checks = await runDoctor({ cfg, posts: [p], now: NOW, env, version: "0.3.0", fetch: fetchImpl });

  assert.equal(find(checks, "linkedin", /rejected the access token/)?.level, "error");
  assert.equal(find(checks, "bluesky", /signed in to Bluesky as @me.example/)?.level, "ok");
  assert.equal(find(checks, "mastodon", /signed in to Mastodon as @me/)?.level, "ok");
  assert.equal(find(checks, "hook", /not called/)?.level, "info");
  assert.equal(find(checks, "hook", /POSTLINE_WEBHOOK_SECRET is not set/)?.level, "warn");
  assert.ok(calls.every((c) => !c.url.includes("createRecord") && !c.url.includes("statuses") && !c.url.endsWith("/posts")));
  assert.ok(!calls.some((c) => c.url.includes("hooks.example")));
});

test("doctor reports stuck ledger entries, stale drafts and a mismatched workflow", async () => {
  const cfg = config({ channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const ledger = new Ledger(cfg.stateDir);
  ledger.set("old", "hook", { status: "uncertain", error: "timed out" });
  ledger.save();
  mkdirSync(join(cfg.root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(cfg.root, ".github", "workflows", "postline.yml"), 'env:\n  POSTLINE_VERSION: "0.2.1"\n');
  const draft = post(cfg, "id: soon\nat: 2026-11-02 09:00\nstatus: draft\nchannels: [hook]");

  const checks = await runDoctor({ cfg, posts: [draft], now: NOW, env: { POSTLINE_WEBHOOK_SECRET: "s" }, version: "0.3.0" });
  assert.equal(find(checks, "ledger", /old -> hook may have gone out/)?.level, "error");
  assert.equal(find(checks, "posts", /soon is still a draft/)?.level, "warn");
  assert.equal(find(checks, "workflow", /installs postline 0.2.1, this is 0.3.0/)?.level, "warn");

  const alerts = doctorAlerts(checks);
  assert.ok(alerts.length >= 1);
  assert.ok(alerts.every((a) => a.event === "doctor" && a.key.startsWith("doctor:")));
});

test("doctor reports a Chromium that won't start", async () => {
  const cfg = config({ channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const p = post(cfg, "id: p1\nat: 2026-11-05 09:00\nchannels: [hook]\ncard:\n  headline: [Hi]");
  const checks = await runDoctor({ cfg, posts: [p], now: NOW, env: {}, version: "0.3.0", launchChromium: async () => "could not start Chromium" });
  assert.equal(find(checks, "chromium", /could not start/)?.level, "error");
});

test("impossible dates such as February 31 are rejected", () => {
  assert.throws(() => config({ channels: { linkedin: { type: "linkedin", organization: "1", tokenExpires: "2026-02-31" } } }), ConfigError);
});

test("a LinkedIn 429 is not reported as a healthy token", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "1", tokenExpires: "2027-01-01" } } });
  const p = post(cfg, "id: p1\nat: 2026-11-05 09:00\nchannels: [linkedin]");
  const fetchImpl = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
  const checks = await runDoctor({ cfg, posts: [p], now: NOW, env: { LINKEDIN_ACCESS_TOKEN: "t" }, version: "0.3.0", fetch: fetchImpl });
  assert.equal(find(checks, "linkedin", /HTTP 429/)?.level, "warn");
  assert.equal(find(checks, "linkedin", /accepted/), undefined);
});

test("an attempting entry is normal while a live publish run holds the lock", async () => {
  const cfg = config({ channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const ledger = new Ledger(cfg.stateDir);
  ledger.set("now", "hook", { status: "attempting" });
  ledger.save();
  writeFileSync(join(cfg.stateDir, "publish.lock"), JSON.stringify({ pid: process.pid, host: (await import("node:os")).hostname(), since: NOW.toISOString() }));
  const checks = await runDoctor({ cfg, posts: [], now: NOW, env: {}, version: "0.3.0" });
  assert.equal(find(checks, "ledger", /may have gone out/), undefined);
  assert.equal(find(checks, "lock", /in progress/)?.level, "info");
});

test("doctor warnings are sent as alerts too", () => {
  const alerts = doctorAlerts([{ level: "warn", area: "linkedin", message: "access token expires in 9 days" }, { level: "info", area: "x", message: "y" }]);
  assert.deepEqual(alerts.map((a) => a.message), ["warning: linkedin: access token expires in 9 days"]);
});

test("doctor warns when brand colours fail WCAG AA contrast", async () => {
  const cfg = config({ brand: { name: "T", colors: { background: "#ffffff", text: "#999999" } } });
  const checks = await runDoctor({ cfg, posts: [], now: NOW, env: {}, version: "0.3.2" });
  assert.match(find(checks, "brand", /below WCAG AA/)?.message ?? "", /text on background 2\.8:1/);
});
