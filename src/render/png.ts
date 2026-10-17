import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import type { Config } from "../config.js";
import type { Post } from "../content.js";
import { cardHtml, SIZES } from "./card.js";
import { assertSafeFileStem, resolveInside } from "../path.js";
import type { CardSize } from "../config.js";
import type { Library } from "../library.js";

export interface RenderedCard {
  file: string;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg";
  cached: boolean;
  hash: string;
  /** Full-quality copy saved in the local library, when one was written this time. */
  libraryFile?: string;
}

export interface RendererOptions {
  /** Local graphics library; omit to skip saving copies. */
  library?: Library;
  /** Called when something non-fatal goes wrong, e.g. the library folder isn't writable. */
  warn?: (message: string) => void;
}

export interface ExportOptions {
  scale: number;
  format: "png" | "jpeg";
  quality: number;
  size?: CardSize;
  out: string;
}

export function cardFile(cfg: Config, post: Post): string {
  assertSafeFileStem(post.id, "post id");
  return resolveInside(join(cfg.outDir, "cards"), `${post.id}.${cfg.card.format === "jpeg" ? "jpg" : "png"}`);
}

function cacheFile(cfg: Config) {
  return join(cfg.stateDir, "cards.json");
}

function readCache(cfg: Config): Record<string, string> {
  const f = cacheFile(cfg);
  if (!existsSync(f)) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export class Renderer {
  private browser?: Browser;
  private cache: Record<string, string>;

  constructor(
    private cfg: Config,
    private options: RendererOptions = {},
  ) {
    this.cache = readCache(cfg);
  }

  private html(post: Post, size: CardSize): string {
    return cardHtml(post.card!, this.cfg.brand, this.cfg.root, size, this.cfg.design);
  }

  private async shoot(html: string, size: CardSize, scale: number, format: "png" | "jpeg", quality: number): Promise<Buffer> {
    const { width, height } = SIZES[size];
    const browser = await this.page();
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    try {
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      return await page.screenshot({ type: format, ...(format === "jpeg" ? { quality } : {}) });
    } finally {
      await page.close();
    }
  }

  /** Saves a lossless, high-resolution copy into the library unless this version is already there. */
  private async keep(post: Post, html: string, hash: string, size: CardSize, posted?: Buffer): Promise<string | undefined> {
    const library = this.options.library;
    if (!library || library.has(post, hash)) return undefined;
    try {
      const { width, height } = SIZES[size];
      const scale = this.cfg.library.scale;
      const reuse = posted && this.cfg.card.format === "png" && this.cfg.card.scale === scale;
      const bytes = reuse ? posted : await this.shoot(html, size, scale, "png", 100);
      return library.save(post, { hash, bytes, ext: "png", width, height, scale, size });
    } catch (error) {
      this.options.warn?.(`could not save ${post.id} to the library at ${library.dir}: ${(error as Error).message}`);
      return undefined;
    }
  }

  /** One-off export at any resolution, format or size, without touching out/cards. */
  async export(post: Post, opts: ExportOptions): Promise<string> {
    if (!post.card) throw new Error(`${post.id} has no card`);
    const size = opts.size ?? post.card.size ?? this.cfg.card.size;
    const buf = await this.shoot(this.html(post, size), size, opts.scale, opts.format, opts.quality);
    mkdirSync(join(opts.out, ".."), { recursive: true });
    writeFileSync(opts.out, buf);
    return opts.out;
  }

  private async page() {
    if (!this.browser) {
      const { chromium } = await import("playwright-core");
      try {
          const executablePath = process.env.POSTLINE_CHROMIUM;
          this.browser = await chromium.launch(executablePath ? { executablePath } : {});
      } catch (err) {
        throw new Error(
          `could not start Chromium for rendering. Run "npx playwright-core install chromium" or set POSTLINE_CHROMIUM.\n${(err as Error).message}`,
        );
      }
    }
    return this.browser;
  }

  async render(post: Post, opts: { force?: boolean } = {}): Promise<RenderedCard> {
    if (!post.card) throw new Error(`${post.id} has no card`);
    const size = post.card.size ?? this.cfg.card.size;
    const { width, height } = SIZES[size];
    const html = this.html(post, size);
    const hash = createHash("sha256")
      .update(html)
      .update(JSON.stringify(this.cfg.card))
      .digest("hex")
      .slice(0, 16);
    const file = cardFile(this.cfg, post);
    const mime = this.cfg.card.format === "jpeg" ? "image/jpeg" : "image/png";

    if (!opts.force && this.cache[post.id] === hash && existsSync(file)) {
      const libraryFile = await this.keep(post, html, hash, size);
      return { file, width, height, mime, cached: true, hash, ...(libraryFile ? { libraryFile } : {}) };
    }

    const buf = await this.shoot(html, size, this.cfg.card.scale, this.cfg.card.format, this.cfg.card.quality);
    mkdirSync(join(this.cfg.outDir, "cards"), { recursive: true });
    writeFileSync(file, buf);
    this.cache[post.id] = hash;
    const libraryFile = await this.keep(post, html, hash, size, buf);
    return { file, width, height, mime, cached: false, hash, ...(libraryFile ? { libraryFile } : {}) };
  }

  /** Writes the HTML next to the image, handy for tweaking the template in a browser. */
  writeHtml(post: Post): string {
    if (!post.card) throw new Error(`${post.id} has no card`);
      assertSafeFileStem(post.id, "post id");
    const size = post.card.size ?? this.cfg.card.size;
      const file = resolveInside(join(this.cfg.outDir, "cards"), `${post.id}.html`);
    mkdirSync(join(this.cfg.outDir, "cards"), { recursive: true });
    writeFileSync(file, this.html(post, size));
    return file;
  }

  async close(): Promise<void> {
    mkdirSync(this.cfg.stateDir, { recursive: true });
    writeFileSync(cacheFile(this.cfg), JSON.stringify(this.cache, null, 2) + "\n");
    await this.browser?.close();
  }
}
