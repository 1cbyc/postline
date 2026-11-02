// `postline preview`: a local page per post showing the card, lint results and
// each channel's text the way that network will present it.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { extname, relative, resolve } from "node:path";
import YAML from "yaml";
import type { ChannelConfig, Config } from "./config.js";
import { loadConfig } from "./config.js";
import { displayPath, loadPosts, textFor, type Post } from "./content.js";
import { lint, type Finding } from "./lint.js";
import { channelLimit } from "./adapters/index.js";
import { esc } from "./render/escape.js";
import { Renderer } from "./render/png.js";
import { HASHTAG_RE, firstLine, links } from "./text.js";
import { humanLabel } from "./time.js";

/** LinkedIn shows roughly this much of a post before "…see more". */
export const LINKEDIN_FOLD = 210;

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export interface ChannelView {
  name: string;
  type: ChannelConfig["type"] | "unknown";
  text: string;
  count: number;
  max: number;
  over: boolean;
  /** Text as HTML: escaped, with links, hashtags, the fold and any overflow marked. */
  html: string;
}

/** Code-unit index where the nth grapheme starts (or the text length). */
function graphemeIndex(text: string, n: number): number {
  let i = 0;
  for (const { index } of segmenter.segment(text)) {
    if (i === n) return index;
    i++;
  }
  return text.length;
}

function graphemeCount(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

/** The last space at or before `limit`, so the fold doesn't split a word. */
function foldIndex(text: string, limit: number): number | undefined {
  if (text.length <= limit) return undefined;
  const space = text.lastIndexOf(" ", limit);
  return space > limit * 0.6 ? space : limit;
}

interface Range {
  start: number;
  end: number;
  cls: string;
}

/** Escape text and wrap links, hashtags, text past the fold and text past the limit. */
export function decorate(text: string, opts: { fold?: number | undefined; limit?: number | undefined } = {}): string {
  const ranges: Range[] = [];
  for (const l of links(text)) ranges.push({ start: l.index, end: l.index + l.text.length, cls: "link" });
  for (const m of text.matchAll(HASHTAG_RE)) {
    const start = (m.index ?? 0) + m[1]!.length;
    ranges.push({ start, end: start + 1 + m[2]!.length, cls: "tag" });
  }
  const cuts = new Set([0, text.length]);
  for (const r of ranges) cuts.add(r.start).add(r.end);
  if (opts.fold !== undefined) cuts.add(opts.fold);
  if (opts.limit !== undefined && opts.limit < text.length) cuts.add(opts.limit);
  const points = [...cuts].sort((a, b) => a - b);

  let out = "";
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (start === opts.fold) out += '<span class="fold" title="Roughly where LinkedIn cuts the post off with “see more”">…see more</span>';
    const classes = ranges.filter((r) => r.start <= start && end <= r.end).map((r) => r.cls);
    if (opts.fold !== undefined && start >= opts.fold) classes.push("folded");
    if (opts.limit !== undefined && start >= opts.limit) classes.push("over");
    const piece = esc(text.slice(start, end));
    out += classes.length ? `<span class="${classes.join(" ")}">${piece}</span>` : piece;
  }
  return out;
}

export function channelView(cfg: Config, post: Post, name: string): ChannelView {
  const ch = cfg.channels[name];
  const text = textFor(post, name);
  if (!ch) return { name, type: "unknown", text, count: text.length, max: Infinity, over: false, html: decorate(text) };
  const limit = channelLimit(ch);
  const count = limit.graphemes ? graphemeCount(text) : text.length;
  const over = count > limit.max;
  const limitAt = over ? (limit.graphemes ? graphemeIndex(text, limit.max) : limit.max) : undefined;
  const fold = ch.type === "linkedin" ? foldIndex(text, LINKEDIN_FOLD) : undefined;
  return { name, type: ch.type, text, count, max: limit.max, over, html: decorate(text, { fold, limit: limitAt }) };
}

const NETWORK: Record<ChannelView["type"], string> = {
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  webhook: "Webhook",
  files: "Files",
  unknown: "Unknown channel",
};

function imageUrl(post: Post): string | undefined {
  if (post.card) return `/card/${encodeURIComponent(post.id)}`;
  if (post.image) return `/image/${encodeURIComponent(post.id)}`;
  return undefined;
}

function altText(post: Post): string {
  return post.alt ?? (post.card ? post.card.headline.join(" ") : "");
}

function channelPanel(cfg: Config, post: Post, view: ChannelView): string {
  const image = imageUrl(post);
  const count = `<span class="count${view.over ? " bad" : ""}">${view.count.toLocaleString("en")}${Number.isFinite(view.max) ? ` / ${view.max.toLocaleString("en")}` : ""}</span>`;
  let body: string;
  if (view.type === "webhook") {
    const payload = {
      delivery: `${post.id}::${view.name}`,
      id: post.id,
      channel: view.name,
      at: post.when?.toISOString(),
      topic: post.topic ?? null,
      text: view.text,
      image: image ? { mime: cfg.card.format === "jpeg" ? "image/jpeg" : "image/png", alt: altText(post), base64: "…" } : null,
    };
    body = `<pre class="payload">${esc(JSON.stringify(payload, null, 2))}</pre>`;
  } else if (view.type === "files") {
    const ch = cfg.channels[view.name];
    // The same front matter the files channel writes.
    const fm: Record<string, unknown> = { title: firstLine(view.text).replace(/^#+\s*/, ""), date: post.when?.toISOString(), topic: post.topic };
    if (image && ch?.type === "files") {
      const ext = post.card ? (cfg.card.format === "jpeg" ? "jpg" : "png") : extname(post.image ?? "").slice(1) || "png";
      const dir = resolve(cfg.root, ch.dir);
      fm.image = ch.assetsUrl ? `${ch.assetsUrl.replace(/\/$/, "")}/${post.id}.${ext}` : relative(dir, resolve(cfg.root, ch.assetsDir ?? ch.dir, `${post.id}.${ext}`));
      fm.imageAlt = altText(post);
    }
    const clean = Object.fromEntries(Object.entries(fm).filter(([, v]) => v != null));
    const path = ch?.type === "files" ? `${ch.dir.replace(/\/$/, "")}/${post.id}.md` : `${post.id}.md`;
    body = `<p class="file-name"><code>${esc(path)}</code></p><pre class="payload">${esc(`---\n${YAML.stringify(clean)}---\n\n${view.text}\n`)}</pre>`;
  } else if (view.type === "unknown") {
    body = `<p class="problem">No channel called “${esc(view.name)}” in the config.</p>`;
  } else {
    const initial = esc((cfg.brand.name.trim()[0] ?? "?").toUpperCase());
    body = `<div class="mock mock-${view.type}">
      <div class="who"><span class="avatar">${initial}</span><span><b>${esc(cfg.brand.name)}</b><small>${post.when ? esc(humanLabel(post.when, cfg.timezone)) : "unscheduled"}</small></span></div>
      <div class="text">${view.html}</div>
      ${image ? `<img src="${image}" alt="${esc(altText(post))}" loading="lazy">` : ""}
    </div>`;
  }
  return `<section class="channel">
    <header><h3>${esc(view.name)}</h3><span class="network">${NETWORK[view.type]}</span>${count}</header>
    ${body}
  </section>`;
}

function findingList(findings: Finding[]): string {
  if (!findings.length) return '<p class="clean">No lint problems.</p>';
  return `<ul class="findings">${findings
    .map((f) => `<li class="${f.severity}"><b>${f.severity === "error" ? "error" : "warn"}</b> <code>${esc(f.rule)}</code> ${esc(f.message)}</li>`)
    .join("")}</ul>`;
}

const STYLE = `
:root{--ink:#191a23;--muted:#5b6070;--line:#dbe3f6;--panel:#f4f7fd;--blue:#1034a6;--bad:#a83a2c;--warn:#8a5a10;color-scheme:light}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:#fff}
a{color:var(--blue)}code,pre{font:13px/1.5 ui-monospace,Menlo,monospace}
.top{display:flex;gap:1rem;align-items:center;justify-content:space-between;padding:.8rem 1.5rem;border-bottom:1px solid var(--line);position:sticky;top:0;background:#fffe;z-index:2}
.top b{font-size:1rem}.live{color:var(--muted);font-size:.85rem}
.shell{display:grid;grid-template-columns:17rem 1fr;min-height:calc(100vh - 3.2rem)}
nav{border-right:1px solid var(--line);padding:1rem .75rem;overflow:auto}
nav a{display:block;padding:.45rem .6rem;border-radius:8px;color:var(--ink);text-decoration:none;font-size:.9rem}
nav a:hover{background:var(--panel)}nav a[aria-current]{background:var(--panel);font-weight:600}
nav small{display:block;color:var(--muted);font-size:.78rem}
nav .err{color:var(--bad)}
main{padding:1.5rem 2rem 4rem;max-width:84rem}
h1{margin:0 0 .25rem;font-size:1.5rem}h3{margin:0;font-size:1rem}
.meta{color:var(--muted);margin:0 0 1.25rem}
.findings{list-style:none;padding:0;margin:0 0 1.5rem}.findings li{padding:.5rem .75rem;border-radius:8px;margin-bottom:.4rem;background:#fdf3e1}
.findings li.error{background:#fbe7e3}.findings b{text-transform:uppercase;font-size:.72rem;letter-spacing:.08em;margin-right:.25rem}
.clean{color:#1d5c3a;margin:0 0 1.5rem}
.card{max-width:28rem}.card img{width:100%;border-radius:12px;box-shadow:0 0 0 1px var(--line)}
.channels{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,23rem),1fr));gap:1.25rem;align-items:start}
.file-name{margin:0;padding:.6rem 1rem;border-bottom:1px solid var(--line)}
.channel{border:1px solid var(--line);border-radius:14px;overflow:hidden}
.channel header{display:flex;gap:.6rem;align-items:baseline;padding:.65rem .9rem;border-bottom:1px solid var(--line);background:var(--panel)}
.network{color:var(--muted);font-size:.85rem}.count{margin-left:auto;font:12px ui-monospace,Menlo,monospace;color:var(--muted)}.count.bad{color:var(--bad);font-weight:700}
.mock{padding:1rem}.who{display:flex;gap:.6rem;align-items:center;margin-bottom:.75rem}
.who small{display:block;color:var(--muted);font-size:.78rem}
.avatar{display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:50%;background:var(--blue);color:#fff;font-weight:700}
.mock-linkedin .avatar{border-radius:6px}
.text{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:.75rem}
.mock img{width:100%;border-radius:10px;box-shadow:0 0 0 1px var(--line)}
.mock-bluesky .link,.mock-bluesky .tag{color:#1083fe}.mock-linkedin .link,.mock-linkedin .tag{color:#0a66c2;font-weight:600}.mock-mastodon .link,.mock-mastodon .tag{color:#6364ff}
.fold{display:inline-block;margin:0 .25rem;padding:0 .35rem;border-radius:4px;background:#e8eefc;color:#0a66c2;font-size:.8rem;font-weight:600}
.folded{color:#8a90a0}.over{background:#fbe7e3;color:var(--bad);text-decoration:line-through}
.payload{margin:0;padding:1rem;overflow:auto;max-height:28rem;white-space:pre-wrap;overflow-wrap:anywhere;background:#191a23;color:#eef0f6}
.problem{padding:1rem;color:var(--bad)}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.55rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
.error-page{padding:2rem;max-width:50rem}.error-page pre{white-space:pre-wrap;background:#fbe7e3;padding:1rem;border-radius:10px}
@media (max-width:900px){.shell{grid-template-columns:minmax(0,1fr)}nav{border-right:0;border-bottom:1px solid var(--line);max-height:30vh}main{padding:1.25rem;min-width:0}table{display:block;overflow-x:auto}}
`;

const RELOAD = `<script>new EventSource("/events").onmessage=()=>location.reload()</script>`;

function page(title: string, cfg: Config | undefined, nav: string, main: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body>
<header class="top"><b>postline preview${cfg ? ` · ${esc(cfg.brand.name)}` : ""}</b><span class="live">Reloads when you save</span></header>
<div class="shell"><nav aria-label="Posts">${nav}</nav><main>${main}</main></div>${RELOAD}</body></html>`;
}

function sortPosts(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity) || a.id.localeCompare(b.id));
}

function navList(cfg: Config, posts: Post[], findings: Finding[], current?: string): string {
  const errors = new Set(findings.filter((f) => f.severity === "error").map((f) => f.post.id));
  return `<a href="/"${current ? "" : ' aria-current="page"'}>All posts</a>${sortPosts(posts)
    .map(
      (p) =>
        `<a href="/post/${encodeURIComponent(p.id)}"${p.id === current ? ' aria-current="page"' : ""}>${esc(p.id)}<small${errors.has(p.id) ? ' class="err"' : ""}>${
          p.when ? esc(humanLabel(p.when, cfg.timezone)) : "unscheduled"
        } · ${p.status}${errors.has(p.id) ? " · lint errors" : ""}</small></a>`,
    )
    .join("")}`;
}

export function indexPage(cfg: Config, posts: Post[], findings: Finding[]): string {
  const rows = sortPosts(posts)
    .map((p) => {
      const mine = findings.filter((f) => f.post === p);
      const errs = mine.filter((f) => f.severity === "error").length;
      return `<tr><td>${p.when ? esc(humanLabel(p.when, cfg.timezone)) : "unscheduled"}</td><td><a href="/post/${encodeURIComponent(p.id)}">${esc(p.id)}</a></td><td>${p.status}</td><td>${esc(p.channels.join(", "))}</td><td>${
        errs ? `<span style="color:var(--bad)">${errs} error${errs === 1 ? "" : "s"}</span>` : mine.length ? `${mine.length} warning${mine.length === 1 ? "" : "s"}` : "clean"
      }</td></tr>`;
    })
    .join("");
  return page(
    `postline preview · ${cfg.brand.name}`,
    cfg,
    navList(cfg, posts, findings),
    `<h1>Posts</h1><p class="meta">${posts.length} post${posts.length === 1 ? "" : "s"} in ${esc(displayPath(cfg, cfg.postsDir))}</p>
<table><thead><tr><th>When</th><th>Post</th><th>Status</th><th>Channels</th><th>Lint</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

export function postPage(cfg: Config, posts: Post[], findings: Finding[], post: Post): string {
  const image = imageUrl(post);
  const views = post.channels.map((name) => channelView(cfg, post, name));
  const meta = [
    post.when ? humanLabel(post.when, cfg.timezone) : "unscheduled",
    post.status,
    post.topic ? `topic: ${post.topic}` : undefined,
    displayPath(cfg, post.file),
  ].filter(Boolean);
  return page(
    `${post.id} · postline preview`,
    cfg,
    navList(cfg, posts, findings, post.id),
    `<h1>${esc(post.id)}</h1><p class="meta">${meta.map((m) => esc(String(m))).join(" · ")}</p>
${findingList(findings.filter((f) => f.post === post))}
<p class="meta">${image ? (post.card ? `Card: <code>${esc(post.card.layout)}</code> layout, rendered from <code>card:</code>.` : "Image from <code>image:</code>.") : "No card or image."}</p>
${views.length ? `<div class="channels">${views.map((v) => channelPanel(cfg, post, v)).join("")}</div>` : image ? `<div class="card"><img src="${image}" alt="${esc(altText(post))}"></div><p>This post has no channels.</p>` : "<p>This post has no channels.</p>"}`,
  );
}

function errorPage(error: unknown): string {
  return page(
    "postline preview: error",
    undefined,
    "",
    `<div class="error-page"><h1>Can't load the project</h1><pre>${esc((error as Error).message ?? String(error))}</pre><p>Fix it and save; this page reloads.</p></div>`,
  );
}

/** Changes whenever the config or any design file a card depends on changes. */
function designSignature(cfg: Config): string {
  const files = [cfg.file, cfg.design.tokensFile, cfg.design.stylesheet, ...Object.values(cfg.design.layouts), cfg.brand.logo ? resolve(cfg.root, cfg.brand.logo) : undefined];
  return files
    .filter((f): f is string => typeof f === "string")
    .map((f) => `${f}:${existsSync(f) ? statSync(f).mtimeMs : "missing"}`)
    .join("|");
}

/** Only answer requests addressed to this machine, so DNS rebinding can't read drafts. */
function localHostHeader(value: string | undefined, port: number): boolean {
  if (!value) return false;
  const allowed = new Set(["127.0.0.1", "localhost", "[::1]"].map((h) => `${h}:${port}`));
  return allowed.has(value.toLowerCase());
}

export interface PreviewOptions {
  cwd: string;
  configFile?: string;
  port: number;
  host?: string;
  log: (line: string) => void;
}

export interface PreviewServer {
  url: string;
  close: () => Promise<void>;
}

/** Start the preview server on localhost. Config and posts are re-read on every request. */
export async function startPreview(opts: PreviewOptions): Promise<PreviewServer> {
  const host = opts.host ?? "127.0.0.1";
  const clients = new Set<ServerResponse>();
  let renderer: { signature: string; instance: Renderer } | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const project = (): { cfg: Config; posts: Post[]; findings: Finding[] } => {
    const cfg = loadConfig(opts.cwd, opts.configFile);
    const posts = loadPosts(cfg);
    return { cfg, posts, findings: lint(cfg, posts) };
  };

  // Renders run one at a time and reuse one browser until the config changes.
  const render = (cfg: Config, post: Post): Promise<string> => {
    const job = queue.then(async () => {
      const signature = designSignature(cfg);
      if (!renderer || renderer.signature !== signature) {
        await renderer?.instance.close();
        renderer = { signature, instance: new Renderer(cfg, { warn: opts.log }) };
      }
      return (await renderer.instance.render(post)).file;
    });
    queue = job.catch(() => undefined);
    return job;
  };

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer): void => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body);
  };

  let boundPort = opts.port;
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!localHostHeader(req.headers.host, boundPort)) return send(res, 403, "text/plain; charset=utf-8", "postline preview only answers localhost");
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    let state: ReturnType<typeof project>;
    try {
      state = project();
    } catch (error) {
      return send(res, 500, "text/html; charset=utf-8", errorPage(error));
    }
    const { cfg, posts, findings } = state;
    if (url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", indexPage(cfg, posts, findings));
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }

    const match = /^\/(post|card|image)\/([^/]+)$/.exec(url.pathname);
    const post = match ? posts.find((p) => p.id === decodeURIComponent(match[2]!)) : undefined;
    if (!match || !post) return send(res, 404, "text/plain; charset=utf-8", "not found");

    if (match[1] === "post") return send(res, 200, "text/html; charset=utf-8", postPage(cfg, posts, findings, post));
    try {
      const file = match[1] === "card" ? (post.card ? await render(cfg, post) : undefined) : post.image;
      if (!file || !existsSync(file)) return send(res, 404, "text/plain; charset=utf-8", "no image");
      const type = [".jpg", ".jpeg"].includes(extname(file).toLowerCase()) ? "image/jpeg" : "image/png";
      return send(res, 200, type, readFileSync(file));
    } catch (error) {
      opts.log(`! ${post.id}: ${(error as Error).message}`);
      return send(res, 500, "text/plain; charset=utf-8", (error as Error).message);
    }
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) send(res, 500, "text/plain; charset=utf-8", String(error));
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => resolveListen());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  boundPort = port;

  // Watch the project and tell open pages to reload. Started only once the
  // server is listening, so a failed start leaves nothing running.
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  const changed = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const client of clients) client.write("data: reload\n\n");
    }, 150);
  };
  try {
    const cfg = loadConfig(opts.cwd, opts.configFile);
    const ignore = [cfg.outDir, cfg.stateDir];
    const watcher = watch(cfg.root, { recursive: true }, (_event, name) => {
      if (!name) return changed();
      const path = `${cfg.root}/${String(name)}`;
      if (ignore.some((dir) => path.startsWith(dir)) || /(^|\/)(node_modules|\.git)(\/|$)/.test(String(name))) return;
      changed();
    });
    watcher.on("error", (error) => {
      opts.log(`! live reload stopped: ${error.message}`);
      watcher.close();
    });
    watchers.push(watcher);
  } catch (error) {
    opts.log(`! live reload is off: ${(error as Error).message}`);
  }

  return {
    url: `http://${host}:${port}/`,
    close: async () => {
      clearTimeout(timer);
      for (const w of watchers) w.close();
      for (const client of clients) client.end();
      await new Promise<void>((done) => server.close(() => done()));
      await queue;
      await renderer?.instance.close();
    },
  };
}
