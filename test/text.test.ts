import { test } from "node:test";
import assert from "node:assert/strict";
import { hashtags, links, hostAllowed, findMojibake, graphemeLength, hasEmoji } from "../src/text.js";
import { toLittleText } from "../src/adapters/linkedin.js";
import { facetsFor } from "../src/adapters/bluesky.js";
import { sign } from "../src/adapters/webhook.js";

test("finds hashtags but not anchors or numbers", () => {
  assert.deepEqual(hashtags("Ship it. #DevOps #CI\nsee page#section and issue #42"), ["DevOps", "CI"]);
});

test("finds explicit links and bare domains with a path", () => {
  const found = links("Read northwind.dev/blog/ci-22-to-6. Also https://example.com/a?b=1, and Node.js alone.");
  assert.deepEqual(
    found.map((l) => l.url),
    ["https://northwind.dev/blog/ci-22-to-6", "https://example.com/a?b=1"],
  );
});

test("domain allow-list matches subdomains", () => {
  assert.ok(hostAllowed("blog.northwind.dev", ["northwind.dev"]));
  assert.ok(!hostAllowed("northwind.dev.evil.com", ["northwind.dev"]));
});

test("detects mojibake from double-decoded UTF-8", () => {
  assert.equal(findMojibake("Turn 5: \u00e2\u20ac\u0153normal\u00e2\u20ac refund"), "\u00e2\u20ac\u0153");
  assert.equal(findMojibake("caf\u00c3\u00a9"), "\u00c3\u00a9");
  assert.equal(findMojibake("Turn 5: \u201cnormal\u201d refund, caf\u00e9, na\u00efve"), undefined);
});

test("counts graphemes, not code units", () => {
  assert.equal(graphemeLength("👍🏽ok"), 3);
  assert.ok(hasEmoji("hi 🥐"));
  assert.ok(!hasEmoji("hi → there"));
});

test("LinkedIn little text escapes reserved chars and keeps hashtags", () => {
  assert.equal(toLittleText("Costs (1/2) #AI_Security done"), "Costs \\(1/2\\) {hashtag|\\#|AI_Security} done");
  assert.equal(toLittleText("1 // a_b"), "1 // a\\_b");
});

test("Bluesky facets use UTF-8 byte offsets", () => {
  const text = "café → example.com/x #tag";
  const f = facetsFor(text);
  assert.equal(f.length, 2);
  const link = f[0]!;
  assert.equal(Buffer.from(text).subarray(link.index.byteStart, link.index.byteEnd).toString(), "example.com/x");
  const tag = f[1]!;
  assert.equal(Buffer.from(text).subarray(tag.index.byteStart, tag.index.byteEnd).toString(), "#tag");
  assert.equal(tag.features[0]!.tag, "tag");
});

test("webhook signature is HMAC-SHA256", () => {
  assert.match(sign("s", "{}"), /^sha256=[0-9a-f]{64}$/);
});
