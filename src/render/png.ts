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

/** Hosts a card page may load from: the brand font, plus any the config allows. */
export function allowedRenderHosts(cfg: Config): string[] {
  const hosts = new Set(cfg.card.allowedHosts);
  if (cfg.brand.font.url) {
    const host = new URL(cfg.brand.font.url).hostname.toLowerCase();
    hosts.add(host);
    // Google Fonts' stylesheet loads the font files from a second host.
    if (host === "fonts.googleapis.com") hosts.add("fonts.gstatic.com");
  }
  return [...hosts];
}

export function hostAllowedForRender(url: string, hosts: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "data:" || parsed.protocol === "about:") return true;
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return hosts.some((allowed) => (allowed.startsWith("*.") ? host.endsWith(allowed.slice(1)) : host === allowed));
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

  private async shoot(
    html: string,
    size: CardSize,
    scale: number,
    format: "png" | "jpeg",
    quality: number,
    label?: string,
  ): Promise<Buffer> {
    const { width, height } = SIZES[size];
    const browser = await this.page();
    // Post text ends up in the page (custom templates may even insert it raw), so
    // cards render with scripts off and can only reach the font host and any
    // hosts the config allows. Nothing else leaves the machine.
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, javaScriptEnabled: false });
    const hosts = allowedRenderHosts(this.cfg);
    await page.route("**/*", (route) => (hostAllowedForRender(route.request().url(), hosts) ? route.continue() : route.abort("blockedbyclient")));
    try {
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      if (label) {
        // Text that doesn't fit is pushed into the margins or off the card, and
        // nothing else would say so.
        const overflow = await page.evaluate(() =>
          [document.body, document.querySelector(".card")].some(
            (el) => el instanceof HTMLElement && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1),
          ),
        );
        if (overflow) {
          this.options.warn?.(`${label}: the card's content doesn't fit the ${size} card; shorten the text or use a larger card.size`);
        }
      }
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

    const buf = await this.shoot(html, size, this.cfg.card.scale, this.cfg.card.format, this.cfg.card.quality, post.id);
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
