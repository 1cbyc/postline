import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import type { Brand, CardSize, Tone } from "../config.js";
import type { CardSpec } from "../content.js";

export const SIZES: Record<CardSize, { width: number; height: number }> = {
  square: { width: 1200, height: 1200 },
  landscape: { width: 1200, height: 627 },
  portrait: { width: 1080, height: 1350 },
};

export function esc(s: string | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function dataUri(file: string): string {
  const mime = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

function logoHtml(brand: Brand, root: string): string {
  let mark = "";
  if (brand.logo) {
    const file = resolve(root, brand.logo);
    if (!existsSync(file)) throw new Error(`brand.logo not found: ${file}`);
    mark =
      extname(file).toLowerCase() === ".svg"
        ? `<span class="mark">${readFileSync(file, "utf8").replace(/<\?xml[^>]*>/, "")}</span>`
        : `<img class="mark" src="${dataUri(file)}" alt="">`;
  }
  const name = brand.showName ? `<span class="name">${esc(brand.name)}</span>` : "";
  return `<div class="logo">${mark}${name}</div>`;
}

function fontHtml(brand: Brand, root: string): string {
  const { family, url, file } = brand.font;
  if (file) {
    const p = resolve(root, file);
    return `<style>@font-face{font-family:"${esc(family)}";src:url(${dataUri(p)});font-weight:100 900;font-display:block}</style>`;
  }
  if (url) return `<link rel="stylesheet" href="${esc(url)}">`;
  return "";
}

function chip(brand: Brand, text: string): string {
  const tone: Tone = brand.chips[text.toLowerCase()] ?? "neutral";
  return `<span class="chip ${tone}">${esc(text)}</span>`;
}

function headline(lines: string[]): string {
  if (lines.length <= 1) return `<h1>${esc(lines[0])}</h1>`;
  const [first, ...rest] = lines;
  return `<h1>${esc(first)}<br><em>${rest.map(esc).join("<br>")}</em></h1>`;
}

function body(spec: CardSpec, brand: Brand): string {
  if (spec.layout === "statement" || spec.items.length === 0) {
    return spec.subline ? `<p class="subline">${esc(spec.subline)}</p>` : "";
  }
  if (spec.layout === "grid") {
    return `<div class="grid n${Math.min(spec.items.length, 4)}">${spec.items
      .slice(0, 4)
      .map(
        (it) => `<div class="panel">
          ${it.label ? `<div class="label">${esc(it.label)}</div>` : ""}
          <div class="title">${esc(it.title)}</div>
          ${it.note ? `<div class="note">${esc(it.note)}</div>` : ""}
          ${it.chip ? chip(brand, it.chip) : ""}
        </div>`,
      )
      .join("")}</div>`;
  }
  return `<div class="rows">${spec.items
    .map(
      (it, i) => `<div class="row">
        <div class="num">${esc(it.label ?? String(i + 1))}</div>
        <div class="text"><div class="title">${esc(it.title)}</div>${it.note ? `<div class="note">${esc(it.note)}</div>` : ""}</div>
        ${it.chip ? chip(brand, it.chip) : ""}
      </div>`,
    )
    .join("")}</div>`;
}

export function cardHtml(spec: CardSpec, brand: Brand, root: string, size: CardSize): string {
  const { width, height } = SIZES[size];
  const c = brand.colors;
  const unit = width / 1200; // 1rem == 10px at 1200 wide
  const wide = size === "landscape";
  const footerRight = brand.url ? `<span class="url">${esc(brand.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</span>` : "";

  return `<!doctype html>
<html><head><meta charset="utf-8">
${fontHtml(brand, root)}
<style>
  :root{
    --bg:${c.background};--panel:${c.panel};--border:${c.border};--text:${c.text};--muted:${c.muted};--accent:${c.accent};
    --ok-bg:${c.ok[0]};--ok:${c.ok[1]};--warn-bg:${c.warn[0]};--warn:${c.warn[1]};--bad-bg:${c.bad[0]};--bad:${c.bad[1]};
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{font-size:${10 * unit}px}
  body{width:${width}px;height:${height}px;overflow:hidden;background:var(--bg);color:var(--text);
    font-family:"${esc(brand.font.family)}",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    -webkit-font-smoothing:antialiased;position:relative}
  body::before{content:"";position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(60rem 45rem at 100% 0%, color-mix(in srgb,var(--accent) 16%,transparent), transparent 70%)}
  .card{position:relative;height:100%;padding:${wide ? "5.6rem 7.2rem 5.2rem" : "8.8rem 8.8rem 7.2rem"};display:flex;flex-direction:column}
  .logo{display:flex;align-items:center;gap:1.4rem;height:4.4rem}
  .logo .mark{height:4.2rem;display:inline-flex;align-items:center}
  .logo .mark svg,.logo img.mark{height:100%;width:auto;display:block}
  .logo .name{font-size:3rem;font-weight:600;letter-spacing:-.01em}
  .main{flex:1;display:flex;${wide ? "flex-direction:row;align-items:center;gap:5.6rem" : "flex-direction:column;justify-content:center;gap:4.8rem;padding:4rem 0"}}
  .head{${wide ? "flex:1.05" : ""}}
  .eyebrow{color:var(--accent);font-size:2.2rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;margin-bottom:2.6rem}
  h1{font-size:${wide ? "4.6rem" : "6.8rem"};line-height:1.06;font-weight:800;letter-spacing:-.035em}
  .statement h1{font-size:${wide ? "6rem" : "8.8rem"}}
  .statement .subline{margin-top:3.2rem}
  h1 em{font-style:normal;color:var(--accent)}
  .subline{color:var(--muted);font-size:3rem;line-height:1.4;max-width:90rem}
  .side{${wide ? "flex:1" : ""}}
  .rows{display:flex;flex-direction:column;gap:${wide ? "1.4rem" : "2rem"}}
  .row{display:flex;align-items:center;gap:2.6rem;background:var(--panel);border:1px solid var(--border);border-radius:1.6rem;padding:${wide ? "2rem 2.4rem" : "3rem 3.2rem"}}
  .num{flex:none;width:${wide ? "5.2rem" : "7.2rem"};height:${wide ? "5.2rem" : "7.2rem"};border-radius:1.2rem;display:grid;place-items:center;
    color:var(--accent);font-weight:700;font-size:${wide ? "2.4rem" : "3rem"};border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));
    background:color-mix(in srgb,var(--accent) 8%,var(--panel))}
  .text{flex:1;min-width:0}
  .title{font-size:${wide ? "2.6rem" : "3.4rem"};font-weight:700;letter-spacing:-.015em;line-height:1.2}
  .note{color:var(--muted);font-size:${wide ? "2rem" : "2.4rem"};margin-top:.8rem;line-height:1.35}
  .label{color:var(--muted);font-size:2.2rem;margin-bottom:1.2rem}
  .chip{flex:none;display:inline-block;border-radius:99rem;padding:.9rem 2rem;font-size:2.2rem;font-weight:700;border:1px solid}
  .chip.ok{color:var(--ok);background:color-mix(in srgb,var(--ok-bg) 35%,transparent);border-color:var(--ok-bg)}
  .chip.warn{color:var(--warn);background:color-mix(in srgb,var(--warn-bg) 35%,transparent);border-color:var(--warn-bg)}
  .chip.bad{color:var(--bad);background:color-mix(in srgb,var(--bad-bg) 35%,transparent);border-color:var(--bad-bg)}
  .chip.neutral{color:var(--muted);border-color:var(--border)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:2rem}
  .grid.n1{grid-template-columns:1fr}
  .panel{background:var(--panel);border:1px solid var(--border);border-radius:1.6rem;padding:${wide ? "2.4rem 2.6rem" : "3.4rem"};display:flex;flex-direction:column;justify-content:flex-start}
  .panel .chip{align-self:flex-start;margin-top:1.6rem}
  footer{display:flex;justify-content:space-between;align-items:flex-end;gap:4rem;color:var(--muted);font-size:2.4rem;line-height:1.35}
  footer .url{color:var(--accent);font-weight:700;white-space:nowrap}
</style></head>
<body><div class="card ${spec.layout === "statement" || spec.items.length === 0 ? "statement" : ""}">
  ${logoHtml(brand, root)}
  <div class="main">
    <div class="head">
      ${spec.eyebrow ? `<div class="eyebrow">${esc(spec.eyebrow)}</div>` : ""}
      ${headline(spec.headline)}
    </div>
    <div class="side">${body(spec, brand)}</div>
  </div>
  <footer><span>${esc(spec.footer)}</span>${footerRight}</footer>
</div></body></html>`;
}
