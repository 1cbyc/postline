import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate, TemplateError } from "../src/render/template.js";
import { parseTokens, tokenCss, tokenTree, discoverLayouts } from "../src/design.js";
import { cardHtml } from "../src/render/card.js";
import { lint } from "../src/lint.js";
import { config, post, tmp } from "./helpers.js";

test("template engine: escaping, raw, dotted names, sections and inverted sections", () => {
  const view = { a: "<b>", n: { x: "deep" }, list: [{ t: "one" }, { t: "two" }], empty: [], yes: true, words: ["x", "y"] };
  assert.equal(renderTemplate("{{a}}|{{{a}}}|{{&a}}|{{n.x}}", view), "&lt;b&gt;|<b>|<b>|deep");
  assert.equal(renderTemplate("{{#list}}[{{t}}]{{/list}}", view), "[one][two]");
  assert.equal(renderTemplate("{{^empty}}none{{/empty}}{{#yes}}!{{/yes}}{{#missing}}?{{/missing}}", view), "none!");
  assert.equal(renderTemplate("{{#words}}{{.}},{{/words}}{{! ignored }}", view), "x,y,");
  assert.equal(renderTemplate("{{#n}}{{x}} {{a}}{{/n}}", view), "deep &lt;b&gt;");
});

test("template engine reports unbalanced sections", () => {
  assert.throws(() => renderTemplate("{{#a}}x", {}), TemplateError);
  assert.throws(() => renderTemplate("{{#a}}x{{/b}}", {}), TemplateError);
  assert.throws(() => renderTemplate("x{{/a}}", {}), TemplateError);
});

test("reads DTCG and Style Dictionary tokens and resolves aliases", () => {
  const tokens = parseTokens(
    JSON.stringify({
      color: {
        blue: { $type: "color", $value: "#1034a6" },
        accent: { $value: "{color.blue}" },
        link: { value: "{color.accent}" },
      },
      space: { md: 16 },
      $description: "ignored",
    }),
  );
  assert.equal(tokens.get("color.accent"), "#1034a6");
  assert.equal(tokens.get("color.link"), "#1034a6");
  assert.equal(tokens.get("space.md"), "16");
  assert.match(tokenCss(tokens), /--color-accent:#1034a6;/);
  assert.deepEqual((tokenTree(tokens).color as Record<string, string>).blue, "#1034a6");
});

test("token alias errors are clear", () => {
  assert.throws(() => parseTokens(JSON.stringify({ a: { $value: "{b}" }, b: { $value: "{a}" } })), /cycle/);
  assert.throws(() => parseTokens(JSON.stringify({ a: { $value: "{nope}" } })), /unknown token/);
  assert.throws(() => parseTokens("{"), /not valid JSON/);
});

test("unsafe token values never reach CSS", () => {
  const tokens = parseTokens(JSON.stringify({ bad: { $value: "red;} body{display:none" }, ok: { $value: "#fff" } }));
  const css = tokenCss(tokens);
  assert.ok(!css.includes("display:none"));
  assert.match(css, /--ok:#fff/);
});

function designProject(): string {
  const root = tmp();
  mkdirSync(join(root, "design", "templates"), { recursive: true });
  writeFileSync(join(root, "design", "tokens.json"), JSON.stringify({ brand: { blue: { $value: "#1034a6" }, ink: { $value: "#111111" } }, font: { $value: "Space Grotesk" } }));
  writeFileSync(join(root, "design", "brand.css"), ".row{border-radius:0} /* $& $' */");
  writeFileSync(
    join(root, "design", "templates", "quote.html"),
    `<header>{{card.headlineFirst}}</header>{{#card.items}}<i class="{{tone}}">{{number}}. {{title}}</i>{{/card.items}}<b>{{data.author}}</b><p>{{brand.urlText}} {{tokens.brand.blue}}</p>`,
  );
  return root;
}

test("brand settings can point at tokens", () => {
  const root = designProject();
  const cfg = config(
    {
      brand: { name: "Labs", url: "https://nsisonglabs.com/", font: { family: "{font}" }, colors: { accent: "{brand.blue}", ok: ["{brand.blue}", "#fff"] } },
      design: { tokens: "design/tokens.json", stylesheet: "design/brand.css", templates: "design/templates" },
    },
    root,
  );
  assert.equal(cfg.brand.colors.accent, "#1034a6");
  assert.deepEqual(cfg.brand.colors.ok, ["#1034a6", "#fff"]);
  assert.equal(cfg.brand.font.family, "Space Grotesk");
  assert.deepEqual(Object.keys(cfg.design.layouts), ["quote"]);
  assert.throws(() => config({ brand: { name: "x", colors: { accent: "{nope}" } }, design: { tokens: "design/tokens.json" } }, root), /unknown token/);
});

test("custom layouts render with injected head, escaping and card data", () => {
  const root = designProject();
  const cfg = config(
    { brand: { name: "Labs", url: "https://nsisonglabs.com/" }, design: { tokens: "design/tokens.json", stylesheet: "design/brand.css", templates: "design/templates" } },
    root,
  );
  const p = post(cfg, `card:\n  layout: quote\n  headline: ["Say <hi> \\u201cnow\\u201d"]\n  items:\n    - title: a & b\n      chip: blocked\n  data:\n    author: Isaac Emmanuel`);
  assert.deepEqual(p.problems, []);
  const html = cardHtml(p.card!, cfg.brand, cfg.root, "square", cfg.design);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<header>Say &lt;hi&gt; “now”<\/header>/, "the <header> tag is not mistaken for <head>");
  assert.match(html, /<i class="bad">1\. a &amp; b<\/i>/);
  assert.match(html, /<b>Isaac Emmanuel<\/b>/);
  assert.match(html, /<p>nsisonglabs\.com #1034a6<\/p>/);
  assert.match(html, /--brand-blue:#1034a6/);
  assert.ok(html.includes("/* $& $' */"), "user CSS is inserted literally");
});

test("built-in layouts also get tokens and the brand stylesheet", () => {
  const root = designProject();
  const cfg = config({ design: { tokens: "design/tokens.json", stylesheet: "design/brand.css" } }, root);
  const p = post(cfg, "card:\n  headline: [Hi]\n  items: [one]");
  const html = cardHtml(p.card!, cfg.brand, cfg.root, "square", cfg.design);
  assert.match(html, /--brand-ink:#111111/);
  assert.ok(html.indexOf(".row{border-radius:0}") > html.indexOf(".row{display:flex"), "brand stylesheet comes after built-in CSS");
});

test("unknown layouts are reported with the available names", () => {
  const root = designProject();
  const cfg = config({ design: { templates: "design/templates" } }, root);
  const p = post(cfg, "at: 2026-10-27 09:00\nchannels: [linkedin]\ncard:\n  layout: poster\n  headline: [Hi]");
  const [finding] = lint(cfg, [p]);
  assert.match(finding!.message, /rows, grid, statement, quote/);
});

test("layout names must be simple", () => {
  const root = tmp();
  mkdirSync(join(root, "t"));
  writeFileSync(join(root, "t", "My Layout.html"), "x");
  assert.throws(() => discoverLayouts(join(root, "t")), /lowercase/);
  assert.throws(() => config({ design: { templates: "../outside" } }, root), /inside the project root/);
});
