import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { channelView, decorate, postPage, startPreview } from "../src/preview.js";
import { lint } from "../src/lint.js";
import { config, post, tmp } from "./helpers.js";

test("decorate escapes text and marks links and hashtags", () => {
  const html = decorate("<b>Read</b> https://example.com/a now #AI");
  assert.match(html, /^&lt;b&gt;Read&lt;\/b&gt; <span class="link">https:\/\/example.com\/a<\/span> now <span class="tag">#AI<\/span>$/);
});

test("LinkedIn shows where the post folds; other networks don't", () => {
  const cfg = config({ channels: { linkedin: { type: "linkedin", organization: "1" }, bluesky: { type: "bluesky" } } });
  const long = `${"word ".repeat(60)}end`;
  const p = post(cfg, "id: p1\nat: 2026-11-05 09:00\nchannels: [linkedin, bluesky]", long);
  assert.match(channelView(cfg, p, "linkedin").html, /class="fold"/);
  assert.doesNotMatch(channelView(cfg, p, "bluesky").html, /class="fold"/);
});

test("text past a network's limit is marked, counting graphemes for Bluesky", () => {
  const cfg = config({ channels: { bluesky: { type: "bluesky", maxChars: 5 } } });
  const p = post(cfg, "id: p1\nat: 2026-11-05 09:00\nchannels: [bluesky]", "👋🏽👋🏽👋🏽👋🏽👋🏽👋🏽👋🏽");
  const view = channelView(cfg, p, "bluesky");
  assert.equal(view.count, 7);
  assert.equal(view.over, true);
  assert.match(view.html, /^👋🏽👋🏽👋🏽👋🏽👋🏽<span class="over">👋🏽👋🏽<\/span>$/);
});

test("the post page shows lint results, the webhook payload and the files output", () => {
  const cfg = config({
    channels: { hook: { type: "webhook", url: "https://hooks.example/x" }, blog: { type: "files", dir: "site/posts" } },
    rules: { allowEmoji: false },
  });
  const p = post(cfg, "id: p1\nat: 2026-11-05 09:00\nchannels: [hook, blog]\ntopic: launch", "Launch day 🚀");
  const html = postPage(cfg, [p], lint(cfg, [p]), p);
  assert.match(html, /<code>emoji<\/code>|emoji/);
  assert.match(html, /&quot;delivery&quot;: &quot;p1::hook&quot;/);
  assert.match(html, /site\/posts\/p1\.md/);
  assert.match(html, /title: Launch day/);
});

test("the preview server serves the index and post pages on localhost", async () => {
  const root = tmp();
  mkdirSync(join(root, "posts"));
  writeFileSync(
    join(root, "postline.config.yaml"),
    "brand: { name: Test Co }\ntimezone: UTC\nchannels:\n  mastodon: { type: mastodon, instance: https://social.example }\n",
  );
  writeFileSync(join(root, "posts", "p1.md"), "---\nat: 2026-11-05 09:00\nchannels: [mastodon]\n---\n\nHello #world\n");
  const server = await startPreview({ cwd: root, port: 0, log: () => {} });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const index = await (await fetch(server.url)).text();
    assert.match(index, /href="\/post\/p1"/);
    const page = await (await fetch(`${server.url}post/p1`)).text();
    assert.match(page, /<span class="tag">#world<\/span>/);
    assert.equal((await fetch(`${server.url}post/nope`)).status, 404);
    assert.equal((await fetch(`${server.url}card/p1`)).status, 404);
  } finally {
    await server.close();
  }
});
