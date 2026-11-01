import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedRenderHosts, hostAllowedForRender } from "../src/render/png.js";
import { contrastRatio, parseColor } from "../src/contrast.js";
import { lint } from "../src/lint.js";
import { ConfigError } from "../src/config.js";
import { config, post } from "./helpers.js";

test("cards may only load from the font host and configured hosts", () => {
  const cfg = config({
    brand: { name: "T", font: { family: "Space Grotesk", url: "https://fonts.googleapis.com/css2?family=Space+Grotesk" } },
    card: { allowedHosts: ["images.example.com", "*.cdn.example"] },
  });
  const hosts = allowedRenderHosts(cfg);
  assert.deepEqual(hosts.sort(), ["*.cdn.example", "fonts.googleapis.com", "fonts.gstatic.com", "images.example.com"]);
  assert.ok(hostAllowedForRender("https://fonts.gstatic.com/s/x.woff2", hosts));
  assert.ok(hostAllowedForRender("https://a.cdn.example/logo.png", hosts));
  assert.ok(hostAllowedForRender("data:image/png;base64,AAAA", hosts));
  assert.ok(!hostAllowedForRender("https://evil.example/leak", hosts));
  assert.ok(!hostAllowedForRender("http://images.example.com/x.png", hosts));
  assert.ok(!hostAllowedForRender("http://127.0.0.1:8080/", hosts));
  assert.ok(!hostAllowedForRender("file:///etc/passwd", hosts));
  assert.throws(() => config({ card: { allowedHosts: ["https://images.example.com/"] } }), ConfigError);
});

test("contrast ratios follow WCAG", () => {
  assert.equal(contrastRatio("#000", "#fff")?.toFixed(1), "21.0");
  assert.equal(contrastRatio("#ffffff", "#1034a6")?.toFixed(1), "10.2");
  assert.equal(contrastRatio("rgb(119, 119, 119)", "#fff")?.toFixed(2), "4.48");
  assert.equal(parseColor("rebeccapurple"), undefined);
  assert.equal(contrastRatio("var(--x)", "#fff"), undefined);
});

test("missing alt text is a warning, or an error with rules.requireAlt", () => {
  for (const [requireAlt, severity] of [[false, "warn"], [true, "error"]] as const) {
    const cfg = config({ rules: { requireAlt } });
    const p = post(cfg, `id: p1\nat: 2026-10-27 09:00\nchannels: [linkedin]\nimage: ${cfg.root}/a.png`);
    assert.equal(lint(cfg, [p]).find((f) => f.rule === "image-alt")?.severity, severity);
  }
});

test("an http:// brand font is rejected, because cards only load over HTTPS", () => {
  assert.throws(() => config({ brand: { name: "T", font: { family: "X", url: "http://fonts.example/x.css" } } }), /https/);
});
