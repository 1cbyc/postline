import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import type { Config } from "../config.js";
import type { Post } from "../content.js";
import { cardHtml, SIZES } from "./card.js";
import { assertSafeFileStem, resolveInside } from "../path.js";

export interface RenderedCard {
  file: string;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg";
  cached: boolean;
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

  constructor(private cfg: Config) {
    this.cache = readCache(cfg);
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
    const html = cardHtml(post.card, this.cfg.brand, this.cfg.root, size);
    const hash = createHash("sha256")
      .update(html)
      .update(JSON.stringify(this.cfg.card))
      .digest("hex")
      .slice(0, 16);
    const file = cardFile(this.cfg, post);
    const mime = this.cfg.card.format === "jpeg" ? "image/jpeg" : "image/png";

    if (!opts.force && this.cache[post.id] === hash && existsSync(file)) {
      return { file, width, height, mime, cached: true };
    }

    const browser = await this.page();
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: this.cfg.card.scale });
    try {
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      mkdirSync(join(this.cfg.outDir, "cards"), { recursive: true });
      const buf = await page.screenshot({
        type: this.cfg.card.format,
        ...(this.cfg.card.format === "jpeg" ? { quality: this.cfg.card.quality } : {}),
      });
      writeFileSync(file, buf);
    } finally {
      await page.close();
    }
    this.cache[post.id] = hash;
    return { file, width, height, mime, cached: false };
  }

  /** Writes the HTML next to the image, handy for tweaking the template in a browser. */
  writeHtml(post: Post): string {
    if (!post.card) throw new Error(`${post.id} has no card`);
      assertSafeFileStem(post.id, "post id");
    const size = post.card.size ?? this.cfg.card.size;
      const file = resolveInside(join(this.cfg.outDir, "cards"), `${post.id}.html`);
    mkdirSync(join(this.cfg.outDir, "cards"), { recursive: true });
    writeFileSync(file, cardHtml(post.card, this.cfg.brand, this.cfg.root, size));
    return file;
  }

  async close(): Promise<void> {
    mkdirSync(this.cfg.stateDir, { recursive: true });
    writeFileSync(cacheFile(this.cfg), JSON.stringify(this.cache, null, 2) + "\n");
    await this.browser?.close();
  }
}
