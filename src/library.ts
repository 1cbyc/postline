// The local graphics library: a folder on the user's computer (by default
// ~/Pictures/postline/<brand>) that keeps a full-quality copy of every card
// postline renders, with a JSON sidecar describing the post, and a gallery
// page to browse them. out/cards is a working folder that gets overwritten;
// the library is the keepsake.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { Config } from "./config.js";
import type { Post } from "./content.js";
import { esc } from "./render/escape.js";
import { assertSafeFileStem } from "./path.js";

export interface PublishedRecord {
  channel: string;
  at: string;
  url?: string;
  remoteId?: string;
}

export interface LibraryMeta {
  id: string;
  file: string;
  hash: string;
  at?: string;
  topic?: string;
  channels: string[];
  alt?: string;
  headline: string[];
  layout?: string;
  size?: string;
  width?: number;
  height?: number;
  scale?: number;
  text: string;
  variants: Record<string, string>;
  source: string;
  brand: string;
  savedAt: string;
  published: PublishedRecord[];
}

export interface SaveInput {
  hash: string;
  bytes: Buffer;
  ext: "png" | "jpg";
  width?: number;
  height?: number;
  scale?: number;
  size?: string;
}

function writeAtomic(file: string, content: string | Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

export class Library {
  readonly dir: string;

  constructor(private cfg: Config) {
    this.dir = cfg.library.dir;
  }

  get indexFile(): string {
    return join(this.dir, "index.html");
  }

  /** 2026-11-02_ten-years_3f9a1c2b: sorts by date, unique per design version. */
  stem(post: Post, hash: string): string {
    assertSafeFileStem(post.id, "post id");
    const date = post.at?.slice(0, 10) ?? "undated";
    const name = post.id.startsWith(date) ? post.id : `${date}_${post.id}`;
    return `${name}_${hash.slice(0, 8)}`;
  }

  has(post: Post, hash: string): boolean {
    const stem = this.stem(post, hash);
    return existsSync(join(this.dir, `${stem}.json`));
  }

  save(post: Post, input: SaveInput): string {
    mkdirSync(this.dir, { recursive: true });
    const stem = this.stem(post, input.hash);
    const imageName = `${stem}.${input.ext}`;
    writeAtomic(join(this.dir, imageName), input.bytes);
    const previous = this.read(join(this.dir, `${stem}.json`));
    const meta: LibraryMeta = {
      id: post.id,
      file: imageName,
      hash: input.hash,
      ...(post.at === undefined ? {} : { at: post.at }),
      ...(post.topic === undefined ? {} : { topic: post.topic }),
      channels: post.channels,
      ...(post.alt === undefined ? {} : { alt: post.alt }),
      headline: post.card?.headline ?? [],
      ...(post.card ? { layout: post.card.layout } : {}),
      ...(input.size === undefined ? {} : { size: input.size }),
      ...(input.width === undefined ? {} : { width: input.width }),
      ...(input.height === undefined ? {} : { height: input.height }),
      ...(input.scale === undefined ? {} : { scale: input.scale }),
      text: post.body,
      variants: post.variants,
      source: relative(this.cfg.root, post.file) || post.file,
      brand: this.cfg.brand.name,
      savedAt: new Date().toISOString(),
      published: previous?.published ?? [],
    };
    writeAtomic(join(this.dir, `${stem}.json`), JSON.stringify(meta, null, 2) + "\n");
    this.writeIndex();
    return join(this.dir, imageName);
  }

  /** Keeps a copy of a hand-made image (the post's `image:` field). */
  saveImageFile(post: Post, imagePath: string, hash: string): string | undefined {
    const ext = extname(imagePath).toLowerCase() === ".png" ? "png" : "jpg";
    if (this.has(post, hash)) return undefined;
    return this.save(post, { hash, bytes: readFileSync(imagePath), ext });
  }

  /** Notes on the newest library copy of a post that it went out, and where. */
  recordPublished(postId: string, record: PublishedRecord): void {
    const entries = this.list().filter((m) => m.id === postId);
    const latest = entries[0];
    if (!latest) return;
    const file = join(this.dir, `${basename(latest.file, extname(latest.file))}.json`);
    latest.published = [...latest.published.filter((p) => p.channel !== record.channel), record];
    writeAtomic(file, JSON.stringify(latest, null, 2) + "\n");
    this.writeIndex();
  }

  private read(file: string): LibraryMeta | undefined {
    if (!existsSync(file)) return undefined;
    try {
      const meta = JSON.parse(readFileSync(file, "utf8")) as LibraryMeta;
      return typeof meta.id === "string" && typeof meta.file === "string" ? { ...meta, published: meta.published ?? [] } : undefined;
    } catch {
      return undefined;
    }
  }

  /** Newest first. */
  list(): LibraryMeta[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.read(join(this.dir, name)))
      .filter((m): m is LibraryMeta => m !== undefined && existsSync(join(this.dir, m.file)))
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "") || b.savedAt.localeCompare(a.savedAt));
  }

  /** A static gallery page that opens straight from the folder, no server needed. */
  writeIndex(): void {
    const items = this.list();
    const cards = items
      .map((m) => {
        const title = m.headline.join(" ") || m.text.split("\n")[0] || m.id;
        const sent = m.published.length
          ? m.published
              .map((p) => (p.url ? `<a href="${esc(p.url)}">${esc(p.channel)}</a>` : esc(p.channel)))
              .join(", ")
          : "not published yet";
        const dims = m.width && m.height && m.scale ? `${Math.round(m.width * m.scale)} x ${Math.round(m.height * m.scale)} px` : "";
        return `<figure>
  <a href="${esc(m.file)}" target="_blank"><img src="${esc(m.file)}" alt="${esc(m.alt ?? title)}" loading="lazy"></a>
  <figcaption>
    <strong>${esc(title)}</strong>
    <span>${esc(m.at ?? "undated")}${m.topic ? ` · ${esc(m.topic)}` : ""}${dims ? ` · ${dims}` : ""}</span>
    <span>Sent: ${sent}</span>
    <details><summary>Post text</summary><pre>${esc(m.text)}</pre></details>
    <a class="dl" href="${esc(m.file)}" download>Download</a>
  </figcaption>
</figure>`;
      })
      .join("\n");
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(this.cfg.brand.name)} graphics</title>
<style>
  :root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--text:#1b1b1b;--muted:#6b6b6b;--line:#e3e3e0}
  @media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1e1e1e;--text:#eee;--muted:#9a9a9a;--line:#2c2c2c}}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  header{padding:28px 24px 8px;max-width:1280px;margin:auto}
  h1{font-size:22px;margin:0 0 4px}
  header p{margin:0;color:var(--muted)}
  main{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;padding:20px 24px 48px;max-width:1280px;margin:auto}
  figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
  figure img{width:100%;display:block;background:var(--line)}
  figcaption{padding:12px 14px 14px;display:flex;flex-direction:column;gap:4px}
  figcaption span{color:var(--muted);font-size:13px}
  figcaption a{color:inherit}
  pre{white-space:pre-wrap;font:13px/1.45 inherit;margin:6px 0 0}
  .dl{margin-top:6px;font-size:13px;font-weight:600}
</style></head>
<body>
<header><h1>${esc(this.cfg.brand.name)} graphics</h1>
<p>${items.length} card${items.length === 1 ? "" : "s"} saved by postline. Images are full quality; click one to open it.</p></header>
<main>
${cards || "<p>No cards yet. Run <code>postline render</code>.</p>"}
</main>
</body></html>
`;
    mkdirSync(this.dir, { recursive: true });
    writeAtomic(this.indexFile, html);
  }
}
