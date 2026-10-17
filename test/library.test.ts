import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/library.js";
import { Ledger } from "../src/ledger.js";
import { publishDue } from "../src/publish.js";
import { normalizeConfig } from "../src/config.js";
import type { Renderer } from "../src/render/png.js";
import { config, post, tmp } from "./helpers.js";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("library defaults to Pictures/postline/<brand> and is off in CI", () => {
  const local = normalizeConfig({ brand: { name: "Nsisong Labs" } }, tmp(), "x", {});
  assert.equal(local.library.enabled, true);
  assert.equal(local.library.dir, join(homedir(), "Pictures", "postline", "nsisong-labs"));
  assert.equal(local.library.scale, 3);
  const ci = normalizeConfig({ brand: { name: "x" } }, tmp(), "x", { CI: "true" });
  assert.equal(ci.library.enabled, false);
  const forced = normalizeConfig({ brand: { name: "x" }, library: { enabled: true, dir: "~/art" } }, tmp(), "x", { CI: "true" });
  assert.equal(forced.library.enabled, true);
  assert.equal(forced.library.dir, join(homedir(), "art"));
});

test("saves versioned copies with metadata and a gallery", () => {
  const dir = tmp();
  const cfg = config({ library: { dir } });
  const p = post(cfg, "id: launch\nat: 2026-11-02 09:00\ntopic: news\ncard:\n  headline: [Big <news>]", "We shipped.");
  const lib = new Library(cfg);
  const file = lib.save(p, { hash: "aaaaaaaa11", bytes: PNG, ext: "png", width: 1200, height: 1200, scale: 3, size: "square" });
  assert.equal(file, join(dir, "2026-11-02_launch_aaaaaaaa.png"));
  assert.ok(lib.has(p, "aaaaaaaa11"));
  assert.ok(!lib.has(p, "bbbbbbbb22"));
  lib.save(p, { hash: "bbbbbbbb22", bytes: PNG, ext: "png" });
  assert.equal(lib.list().length, 2, "an edited card is kept alongside the old version");

  const meta = JSON.parse(readFileSync(join(dir, "2026-11-02_launch_aaaaaaaa.json"), "utf8"));
  assert.equal(meta.text, "We shipped.");
  assert.equal(meta.topic, "news");
  const index = readFileSync(lib.indexFile, "utf8");
  assert.match(index, /2 cards saved/);
  assert.match(index, /Big &lt;news&gt;/);
  assert.match(index, /3600 x 3600 px/);
});

test("publishing notes where each card went, and keeps hand-made images", async () => {
  const dir = tmp();
  const cfg = config({ library: { dir }, channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const card = join(cfg.root, "card.png");
  writeFileSync(card, PNG);
  const photo = join(cfg.root, "photo.png");
  writeFileSync(photo, PNG);
  const withCard = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [hook]\ncard:\n  headline: [One]");
  const withPhoto = post(cfg, "id: p2\nat: 2026-10-27 08:30\nchannels: [hook]\nimage: photo.png", "Photo post", join(cfg.root, "p2.md"));
  const library = new Library(cfg);
  library.save(withCard, { hash: "cafebabe00", bytes: PNG, ext: "png" });
  const renderer = { render: async () => ({ file: card, width: 1200, height: 1200, mime: "image/png", cached: true, hash: "cafebabe00" }) } as unknown as Renderer;
  const fetchImpl = (async () => new Response(JSON.stringify({ url: "https://example.org/post/1" }), { status: 200 })) as unknown as typeof fetch;
  const lines: string[] = [];
  await publishDue(cfg, [withCard, withPhoto], new Ledger(cfg.stateDir), {
    now: new Date("2026-10-27T13:05:00Z"),
    dryRun: false,
    catchUp: false,
    deps: { env: {}, fetch: fetchImpl, root: cfg.root, requestTimeoutMs: 1000 },
    renderer: () => renderer,
    library,
    log: (l) => lines.push(l),
  });
  const items = library.list();
  const p1 = items.find((m) => m.id === "p1")!;
  assert.deepEqual(p1.published.map((p) => [p.channel, p.url]), [["hook", "https://example.org/post/1"]]);
  const p2 = items.find((m) => m.id === "p2")!;
  assert.ok(existsSync(join(dir, p2.file)));
  assert.equal(p2.published[0]?.channel, "hook");
  assert.match(readFileSync(library.indexFile, "utf8"), /href="https:\/\/example.org\/post\/1">hook/);
});

test("a broken library never breaks publishing", async () => {
  const blocker = join(tmp(), "file");
  writeFileSync(blocker, "not a folder");
  const cfg = config({ library: { dir: join(blocker, "sub") }, channels: { hook: { type: "webhook", url: "https://hooks.example/x" } } });
  const photo = join(cfg.root, "photo.png");
  writeFileSync(photo, PNG);
  const p = post(cfg, "id: p1\nat: 2026-10-27 09:00\nchannels: [hook]\nimage: photo.png", "Hello world.", join(cfg.root, "p1.md"));
  const lines: string[] = [];
  const out = await publishDue(cfg, [p], new Ledger(cfg.stateDir), {
    now: new Date("2026-10-27T13:05:00Z"),
    dryRun: false,
    catchUp: false,
    deps: { env: {}, fetch: (async () => new Response("ok")) as unknown as typeof fetch, root: cfg.root, requestTimeoutMs: 1000 },
    renderer: () => {
      throw new Error("unused");
    },
    library: new Library(cfg),
    log: (l) => lines.push(l),
  });
  assert.equal(out[0]?.result, "published");
  assert.ok(lines.some((l) => l.includes("could not copy image to the library")));
});
