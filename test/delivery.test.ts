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

test("a card that fails to render is not marked as attempted", async () => {
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
  assert.equal(ledger.get("p1", "hook")?.attempts, 0);
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
