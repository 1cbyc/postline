import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ledger } from "../src/ledger.js";
import { publishDue, type PublishOptions } from "../src/publish.js";
import { recordKeyFor } from "../src/adapters/bluesky.js";
import type { Renderer } from "../src/render/png.js";
import { config, post } from "./helpers.js";

const env = {
  LINKEDIN_ACCESS_TOKEN: "t",
  POSTLINE_WEBHOOK_SECRET: "s",
  BLUESKY_IDENTIFIER: "me.example",
  BLUESKY_APP_PASSWORD: "pw",
};

function opts(fetchImpl: typeof fetch, now: string, extra: Partial<PublishOptions> = {}): PublishOptions {
  return {
    now: new Date(now),
    dryRun: false,
    catchUp: false,
    deps: { env, fetch: fetchImpl, root: "/", requestTimeoutMs: 50 },
    renderer: () => {
      throw new Error("no renderer in tests");
    },
    log: () => {},
    ...extra,
  };
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

function linkedInSetup() {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "42" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]");
  return { cfg, p };
}

const never = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });

test("a 5xx on LinkedIn's create call is uncertain and never retried automatically", async () => {
  const { cfg, p } = linkedInSetup();
  const ledger = new Ledger(cfg.stateDir);
  const { f, calls } = fakeFetch(() => new Response("upstream", { status: 502 }));

  const first = await publishDue(cfg, [p], ledger, opts(f, "2026-10-27T13:05:00Z"));
  assert.deepEqual(first.map((o) => o.result), ["uncertain"]);
  assert.equal(new Ledger(cfg.stateDir).get("p1", "linkedin")?.status, "uncertain");
  assert.match(new Ledger(cfg.stateDir).get("p1", "linkedin")!.error!, /may have gone out/);

  const second = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:20:00Z"));
  assert.deepEqual(second.map((o) => o.result), ["blocked"]);
  assert.equal(calls.length, 1);

  // `postline retry` clears it and the next run sends again.
  const cleared = new Ledger(cfg.stateDir);
  cleared.reset("p1", "linkedin");
  cleared.save();
  const ok = fakeFetch(() => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:9" } }));
  const third = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(ok.f, "2026-10-27T13:35:00Z"));
  assert.deepEqual(third.map((o) => o.result), ["published"]);
});

test("a timeout on LinkedIn's create call is uncertain", async () => {
  const { cfg, p } = linkedInSetup();
  const { f } = fakeFetch(never);
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:05:00Z"));
  assert.deepEqual(out.map((o) => o.result), ["uncertain"]);
  assert.match(out[0]!.detail!, /timed out/);
});

test("LinkedIn accepting a post without an id is uncertain, not failed", async () => {
  const { cfg, p } = linkedInSetup();
  const { f } = fakeFetch(() => new Response(null, { status: 201 }));
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:05:00Z"));
  assert.deepEqual(out.map((o) => o.result), ["uncertain"]);
});

test("a failure before the create call stays retryable", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "42" } } });
  const imagePath = join(cfg.root, "a.png");
  writeFileSync(imagePath, Buffer.from([137, 80, 78, 71]));
  const p = post(cfg, `id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]\nimage: ${imagePath}`);
  const { f, calls } = fakeFetch(() => new Response("down", { status: 503 }));
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:05:00Z"));
  assert.deepEqual(out.map((o) => o.result), ["failed"]);
  assert.ok(calls.every((url) => !url.endsWith("/posts")));
});

test("a card that fails to render counts as an attempt but sends nothing", async () => {
  const cfg = config({ channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [hook]\ncard:\n  headline: [One]");
  const broken = {
    render: async () => {
      throw new Error("chromium is not installed");
    },
  } as unknown as Renderer;
  const { f, calls } = fakeFetch(() => new Response("ok"));
  const ledger = new Ledger(cfg.stateDir);
  const out = await publishDue(cfg, [p], ledger, opts(f, "2026-10-27T13:05:00Z", { renderer: () => broken }));
  assert.deepEqual(out.map((o) => o.result), ["failed"]);
  assert.equal(ledger.get("p1", "hook")?.attempts, 1);
  assert.equal(calls.length, 0);
});

test("a webhook that times out is uncertain", async () => {
  const cfg = config({ channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [hook]");
  const { f } = fakeFetch(never);
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:05:00Z"));
  assert.deepEqual(out.map((o) => o.result), ["uncertain"]);
});

test("Bluesky record keys are stable, valid TIDs ordered by time", () => {
  const at = new Date("2026-10-27T13:00:00Z");
  const key = recordKeyFor("p1", "bluesky", at);
  assert.match(key, /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
  assert.equal(key, recordKeyFor("p1", "bluesky", at));
  assert.notEqual(key, recordKeyFor("p2", "bluesky", at));
  assert.ok(recordKeyFor("p1", "bluesky", new Date("2026-10-28T13:00:00Z")) > key);
});

function blueskyFake(state: { created?: { rkey: string; text: string } }, failCreate: boolean) {
  return fakeFetch(async (url, init) => {
    if (url.endsWith("createSession")) return Response.json({ accessJwt: "jwt", did: "did:plc:me", handle: "me.example" });
    if (url.includes("getRecord")) {
      const rkey = new URL(url).searchParams.get("rkey");
      if (state.created && state.created.rkey === rkey) {
        return Response.json({ uri: `at://did:plc:me/app.bsky.feed.post/${rkey}`, value: { text: state.created.text } });
      }
      return Response.json({ error: "RecordNotFound" }, { status: 400 });
    }
    if (url.endsWith("createRecord")) {
      const body = JSON.parse(String(init?.body)) as { rkey: string; record: { text: string } };
      state.created = { rkey: body.rkey, text: body.record.text };
      if (failCreate) throw new TypeError("fetch failed: socket hang up");
      return Response.json({ uri: `at://did:plc:me/app.bsky.feed.post/${body.rkey}` });
    }
    return new Response("unexpected", { status: 500 });
  });
}

test("a Bluesky retry finds the first attempt's post instead of posting twice", async () => {
  const cfg = config({ channels: { bluesky: { type: "bluesky" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [bluesky]", "Hello sky.");
  const state: { created?: { rkey: string; text: string } } = {};

  const lost = blueskyFake(state, true);
  const first = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(lost.f, "2026-10-27T13:05:00Z"));
  assert.deepEqual(first.map((o) => o.result), ["failed"]);

  const retry = blueskyFake(state, false);
  const second = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(retry.f, "2026-10-27T13:20:00Z"));
  assert.deepEqual(second.map((o) => o.result), ["published"]);
  assert.ok(retry.calls.every((url) => !url.endsWith("createRecord")));
  const entry = new Ledger(cfg.stateDir).get("p1", "bluesky");
  assert.equal(entry?.remoteId, `at://did:plc:me/app.bsky.feed.post/${state.created!.rkey}`);
  assert.equal(entry?.url, `https://bsky.app/profile/me.example/post/${state.created!.rkey}`);
});

test("Bluesky refuses to treat a different post at the same key as sent", async () => {
  const cfg = config({ channels: { bluesky: { type: "bluesky" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [bluesky]", "Edited text.");
  const state = { created: { rkey: recordKeyFor("p1", "bluesky", p.when!), text: "Original text." } };
  const { f, calls } = blueskyFake(state, false);
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:05:00Z"));
  assert.deepEqual(out.map((o) => o.result), ["failed"]);
  assert.match(out[0]!.detail!, /different text/);
  assert.ok(calls.every((url) => !url.endsWith("createRecord")));
});

test("a card that can never render stops retrying after maxAttempts", async () => {
  const cfg = config({ channels: { hook: { type: "webhook", url: "https://hooks.example/x" } }, publish: { maxAttempts: 2 } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [hook]\ncard:\n  headline: [One]");
  const broken = { render: async () => Promise.reject(new Error("template error")) } as unknown as Renderer;
  const { f } = fakeFetch(() => new Response("ok"));
  const ledger = new Ledger(cfg.stateDir);
  const run = (at: string) => publishDue(cfg, [p], ledger, opts(f, at, { renderer: () => broken }));
  assert.deepEqual((await run("2026-10-27T13:05:00Z")).map((o) => o.result), ["failed"]);
  assert.deepEqual((await run("2026-10-27T13:20:00Z")).map((o) => o.result), ["failed"]);
  assert.deepEqual((await run("2026-10-27T13:35:00Z")).map((o) => o.result), ["blocked"]);
});

function mastodonSetup() {
  const cfg = config({ channels: { mastodon: { type: "mastodon", instance: "https://social.example" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [mastodon]", "Hello fediverse.");
  return { cfg, p };
}

test("an unclear Mastodon failure is retried inside the idempotency window, with the same key", async () => {
  const { cfg, p } = mastodonSetup();
  const keys: string[] = [];
  let calls = 0;
  const f = (async (_url: string, init?: RequestInit) => {
    keys.push(String((init?.headers as Record<string, string>)["Idempotency-Key"]));
    calls++;
    return calls === 1 ? new Response("bad gateway", { status: 502 }) : Response.json({ id: "9", url: "https://social.example/@me/9" });
  }) as unknown as typeof fetch;
  const ledger = new Ledger(cfg.stateDir);
  const env = { ...opts(f, "2026-10-27T13:05:00Z").deps.env, MASTODON_ACCESS_TOKEN: "m" };
  const first = await publishDue(cfg, [p], ledger, { ...opts(f, "2026-10-27T13:05:00Z"), deps: { env, fetch: f, root: "/" } });
  assert.deepEqual(first.map((o) => o.result), ["failed"]);
  assert.ok(ledger.get("p1", "mastodon")?.retryBefore);
  const second = await publishDue(cfg, [p], ledger, { ...opts(f, "2026-10-27T13:20:00Z"), deps: { env, fetch: f, root: "/" } });
  assert.deepEqual(second.map((o) => o.result), ["published"]);
  assert.equal(new Set(keys).size, 1);
  assert.equal(ledger.get("p1", "mastodon")?.retryBefore, undefined);
});

test("once Mastodon's idempotency window has passed, an unclear failure is uncertain, not retried", async () => {
  const { cfg, p } = mastodonSetup();
  const { f, calls } = fakeFetch(() => new Response("bad gateway", { status: 502 }));
  const ledger = new Ledger(cfg.stateDir);
  const env = { MASTODON_ACCESS_TOKEN: "m" };
  await publishDue(cfg, [p], ledger, { ...opts(f, "2026-10-27T13:05:00Z"), deps: { env, fetch: f, root: "/" } });
  const sent = calls.length;
  const late = await publishDue(cfg, [p], ledger, { ...opts(f, "2026-10-27T14:30:00Z"), catchUp: true, deps: { env, fetch: f, root: "/" } });
  assert.deepEqual(late.map((o) => o.result), ["blocked"]);
  assert.equal(calls.length, sent);
  assert.equal(ledger.get("p1", "mastodon")?.status, "uncertain");
});

test("a webhook whose JSON reply doesn't parse still counts as sent, with a warning", async () => {
  const cfg = config({ channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [hook]");
  const { f } = fakeFetch(() => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }));
  const lines: string[] = [];
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:05:00Z", { log: (l) => lines.push(l) }));
  assert.deepEqual(out.map((o) => o.result), ["published"]);
  assert.ok(lines.some((l) => /not valid JSON/.test(l)));
});

test("a Mastodon retry deadline survives later failures that happen before sending", async () => {
  const { cfg, p } = mastodonSetup();
  const env = { MASTODON_ACCESS_TOKEN: "m" };
  const ledger = new Ledger(cfg.stateDir);
  const unclear = fakeFetch(() => new Response("bad gateway", { status: 502 }));
  await publishDue(cfg, [p], ledger, { ...opts(unclear.f, "2026-10-27T13:05:00Z"), deps: { env, fetch: unclear.f, root: "/" } });
  const deadline = ledger.get("p1", "mastodon")?.retryBefore;
  assert.ok(deadline);
  // A later attempt fails before the status request (the instance is down for uploads).
  const card = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [mastodon]\ncard:\n  headline: [Hi]", "Hello fediverse.");
  const broken = { render: async () => Promise.reject(new Error("render failed")) } as unknown as Renderer;
  await publishDue(cfg, [card], ledger, { ...opts(unclear.f, "2026-10-27T13:20:00Z", { renderer: () => broken }), deps: { env, fetch: unclear.f, root: "/" } });
  assert.equal(ledger.get("p1", "mastodon")?.retryBefore, deadline);
  // Past the deadline, nothing is sent.
  const sent = unclear.calls.length;
  const late = await publishDue(cfg, [p], ledger, { ...opts(unclear.f, "2026-10-27T14:10:00Z"), catchUp: true, deps: { env, fetch: unclear.f, root: "/" } });
  assert.deepEqual(late.map((o) => o.result), ["blocked"]);
  assert.equal(unclear.calls.length, sent);
});

test("the Mastodon deadline is checked again just before sending", async () => {
  const { cfg, p } = mastodonSetup();
  const env = { MASTODON_ACCESS_TOKEN: "m" };
  const ledger = new Ledger(cfg.stateDir);
  ledger.set("p1", "mastodon", { status: "failed", error: "HTTP 502", retryBefore: "2026-10-27T13:30:00.000Z" }, new Date("2026-10-27T12:40:00Z"));
  // The run starts before the deadline, so the early guard lets it through...
  const { f, calls } = fakeFetch(() => Response.json({ id: "9" }));
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  try {
    const run = publishDue(cfg, [p], ledger, { ...opts(f, "2026-10-27T13:29:59Z"), deps: { env, fetch: f, root: "/" } });
    // ...but by the time it would send, the run's clock has passed the deadline.
    shift = 5_000;
    const out = await run;
    assert.deepEqual(out.map((o) => o.result), ["uncertain"]);
  } finally {
    Date.now = realNow;
  }
  assert.ok(calls.every((url) => !url.endsWith("/statuses")));
});

test("a webhook JSON content type is matched case-insensitively", async () => {
  const cfg = config({ channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [hook]");
  const { f } = fakeFetch(() => new Response("{oops", { status: 200, headers: { "content-type": "Application/JSON" } }));
  const lines: string[] = [];
  await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:05:00Z", { log: (l) => lines.push(l) }));
  assert.ok(lines.some((l) => /not valid JSON/.test(l)));
});
