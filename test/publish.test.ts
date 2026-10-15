import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Ledger } from "../src/ledger.js";
import { publishDue, type PublishOptions } from "../src/publish.js";
import type { Renderer } from "../src/render/png.js";
import { config, post } from "./helpers.js";

function opts(fetchImpl: typeof fetch, now: string, extra: Partial<PublishOptions> = {}): PublishOptions & { lines: string[] } {
  const lines: string[] = [];
  return {
    now: new Date(now),
    dryRun: false,
    catchUp: false,
    deps: { env: { LINKEDIN_ACCESS_TOKEN: "t", POSTLINE_WEBHOOK_SECRET: "s" }, fetch: fetchImpl, root: "/" },
    renderer: () => {
      throw new Error("no renderer in tests");
    },
    log: (l) => lines.push(l),
    lines,
    ...extra,
  } as PublishOptions & { lines: string[] };
}

function fakeLinkedIn() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/posts")) return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:1" } });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("publishes due posts once and records them", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "42" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]", "Hello (world) #AI");
  const ledger = new Ledger(cfg.stateDir);
  const { f, calls } = fakeLinkedIn();

  const early = await publishDue(cfg, [p], ledger, opts(f, "2026-10-27T12:59:00Z"));
  assert.equal(early.length, 0);

  const out = await publishDue(cfg, [p], ledger, opts(f, "2026-10-27T13:05:00Z"));
  assert.deepEqual(out.map((o) => o.result), ["published"]);
  const body = JSON.parse(String(calls[0]!.init!.body));
  assert.equal(body.author, "urn:li:organization:42");
  assert.equal(body.commentary, "Hello \\(world\\) {hashtag|\\#|AI}");
  assert.equal(ledger.get("p1", "linkedin")?.status, "published");

  // reload from disk: second run sends nothing
  const again = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:20:00Z"));
  assert.equal(again.length, 0);
  assert.equal(calls.length, 1);
});

test("an unfinished attempt blocks instead of double posting", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "42" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]");
  const ledger = new Ledger(cfg.stateDir);
  ledger.set("p1", "linkedin", { status: "attempting" });
  const { f, calls } = fakeLinkedIn();
  const out = await publishDue(cfg, [p], ledger, opts(f, "2026-10-27T13:05:00Z"));
  assert.deepEqual(out.map((o) => o.result), ["blocked"]);
  assert.equal(calls.length, 0);
});

test("failures are retried up to maxAttempts", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "42" } }, publish: { maxAttempts: 2 } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]");
  const ledger = new Ledger(cfg.stateDir);
  const failing = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const r1 = await publishDue(cfg, [p], ledger, opts(failing, "2026-10-27T13:05:00Z"));
  const r2 = await publishDue(cfg, [p], ledger, opts(failing, "2026-10-27T13:20:00Z"));
  const r3 = await publishDue(cfg, [p], ledger, opts(failing, "2026-10-27T13:35:00Z"));
  assert.deepEqual([r1[0]!.result, r2[0]!.result, r3[0]!.result], ["failed", "failed", "blocked"]);
  assert.match(ledger.get("p1", "linkedin")!.error!, /HTTP 500 nope/);
});

test("late posts are skipped unless catching up", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "42" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]");
  const { f } = fakeLinkedIn();
  const late = await publishDue(cfg, [p], new Ledger(cfg.stateDir + "/a"), opts(f, "2026-10-28T13:00:00Z"));
  assert.equal(late[0]!.result, "skipped");
  const caught = await publishDue(cfg, [p], new Ledger(cfg.stateDir + "/b"), opts(f, "2026-10-28T13:00:00Z", { catchUp: true }));
  assert.equal(caught[0]!.result, "published");
});

test("posts with lint errors are never sent", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "42" } }, rules: { allowEmoji: false } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]", "launch 🚀");
  const { f, calls } = fakeLinkedIn();
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:05:00Z"));
  assert.equal(out[0]!.result, "blocked");
  assert.equal(calls.length, 0);
});

test("dry run touches nothing", async () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "42" } } });
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]");
  const { f, calls } = fakeLinkedIn();
  const ledger = new Ledger(cfg.stateDir);
  const out = await publishDue(cfg, [p], ledger, opts(f, "2026-10-27T13:05:00Z", { dryRun: true }));
  assert.equal(out[0]!.result, "dry-run");
  assert.equal(calls.length, 0);
  assert.ok(!existsSync(ledger.file));
});

test("webhook and files channels", async () => {
  const cfg = config({
    channels: { hook: { type: "webhook", url: "https://hooks.example/x" }, archive: { type: "files", dir: "archive" } },
  });
  const imgDir = join(cfg.root, "img");
  mkdirSync(imgDir, { recursive: true });
  writeFileSync(join(imgDir, "a.png"), Buffer.from([137, 80, 78, 71]));
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [hook, archive]\nimage: ../img/a.png\nalt: a chart", "Title line\n\nBody.", join(cfg.root, "posts", "p1.md"));
  let sent: { headers: Record<string, string>; body: string } | undefined;
  const f = (async (_url: string, init: RequestInit) => {
    sent = { headers: init.headers as Record<string, string>, body: String(init.body) };
    return new Response(JSON.stringify({ id: "zap-1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const o = opts(f, "2026-10-27T13:05:00Z");
  o.deps.root = cfg.root;
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), o);
  assert.deepEqual(out.map((x) => x.result), ["published", "published"]);
  assert.match(sent!.headers["X-Postline-Signature"]!, /^sha256=/);
  assert.equal(JSON.parse(sent!.body).image.alt, "a chart");
  const md = readFileSync(join(cfg.root, "archive", "p1.md"), "utf8");
  assert.match(md, /title: Title line/);
  assert.ok(existsSync(join(cfg.root, "archive", "p1.png")));
});

test("renders cards through the injected renderer", async () => {
  const cfg = config({ channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const card = join(cfg.root, "card.png");
  writeFileSync(card, Buffer.from([1, 2, 3]));
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [hook]\ncard:\n  headline: [One, Two]");
  let rendered = 0;
  const fakeRenderer = {
    render: async () => {
      rendered++;
      return { file: card, width: 1200, height: 1200, mime: "image/png", cached: false };
    },
  } as unknown as Renderer;
  const f = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), opts(f, "2026-10-27T13:05:00Z", { renderer: () => fakeRenderer }));
  assert.equal(out[0]!.result, "published");
  assert.equal(rendered, 1);
});
