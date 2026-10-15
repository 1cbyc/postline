import { test } from "node:test";
import assert from "node:assert/strict";
import { cardHtml } from "../src/render/card.js";
import { config, post } from "./helpers.js";

test("card HTML escapes text and declares UTF-8", () => {
  const cfg = config();
  const p = post(cfg, `card:\n  eyebrow: "<b>x</b>"\n  headline: ["Say \\u201chi\\u201d", "two"]\n  items:\n    - title: "a & b"\n      chip: detected`);
  const html = cardHtml(p.card!, cfg.brand, cfg.root, "square");
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /a &amp; b/);
  assert.match(html, /\u201chi\u201d/);
  assert.match(html, /class="chip warn">detected/);
  assert.match(html, /<em>two<\/em>/);
});
