import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Config } from "./config.js";
import { type Post, textFor } from "./content.js";
import { Ledger } from "./ledger.js";
import { lint } from "./lint.js";
import { createAdapter, type AdapterDeps, type MediaInput } from "./adapters/index.js";
import type { Renderer } from "./render/png.js";
import type { Library } from "./library.js";
import { firstLine } from "./text.js";

export interface PublishOptions {
  now: Date;
  dryRun: boolean;
  catchUp: boolean;
  prepareOnly?: boolean;
  resumePrepared?: boolean;
  only?: string;
  deps: AdapterDeps;
  renderer: () => Renderer;
  /** Local graphics library. Publishing never fails because of it. */
  library?: Library;
  log: (line: string) => void;
}

export interface Outcome {
  post: string;
  channel: string;
  result: "prepared" | "published" | "dry-run" | "failed" | "skipped" | "blocked";
  detail?: string;
}

export function duePairs(cfg: Config, posts: Post[], ledger: Ledger, now: Date, only?: string) {
  const pairs: { post: Post; channel: string }[] = [];
  for (const post of posts) {
    if (post.status !== "ready" || !post.when) continue;
    if (only && post.id !== only) continue;
    if (post.when.getTime() > now.getTime()) continue;
    for (const channel of post.channels) {
      const e = ledger.get(post.id, channel);
      if (e?.status === "published" || e?.status === "skipped") continue;
      pairs.push({ post, channel });
    }
  }
  return pairs.sort((a, b) => a.post.when!.getTime() - b.post.when!.getTime());
}

async function mediaFor(post: Post, opts: PublishOptions, cache: Map<string, MediaInput | undefined>) {
  if (cache.has(post.id)) return cache.get(post.id);
  let media: MediaInput | undefined;
  const alt = post.alt ?? (post.card ? post.card.headline.join(" ") : firstLine(post.body));
  if (post.image) {
    const ext = extname(post.image).toLowerCase();
    if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") throw new Error(`${post.id}: image must be PNG or JPEG`);
    const bytes = readFileSync(post.image);
    media = { bytes, mime: ext === ".png" ? "image/png" : "image/jpeg", alt };
    if (opts.library && !opts.dryRun) {
      try {
        opts.library.saveImageFile(post, post.image, createHash("sha256").update(bytes).digest("hex"));
      } catch (error) {
        opts.log(`! ${post.id}: could not copy image to the library: ${(error as Error).message}`);
      }
    }
  } else if (post.card) {
    const r = await opts.renderer().render(post);
    media = { bytes: readFileSync(r.file), mime: r.mime, alt, width: r.width, height: r.height };
  }
  cache.set(post.id, media);
  return media;
}

export async function publishDue(cfg: Config, posts: Post[], ledger: Ledger, opts: PublishOptions): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const broken = new Set(lint(cfg, posts).filter((f) => f.severity === "error").map((f) => f.post.id));
  const media = new Map<string, MediaInput | undefined>();

  for (const { post, channel } of duePairs(cfg, posts, ledger, opts.now, opts.only)) {
    const tag = `${post.id} -> ${channel}`;
    const entry = ledger.get(post.id, channel);

    if (opts.resumePrepared && entry?.status !== "attempting") continue;
    if (!opts.resumePrepared && entry?.status === "attempting") {
      // A previous run started this and never recorded the result. It may have
      // gone out. Don't guess; a human checks and runs `postline retry`.
      outcomes.push({ post: post.id, channel, result: "blocked", detail: "previous attempt did not finish, check the channel then run postline retry" });
      opts.log(`! ${tag}: previous attempt did not finish; check ${channel} and run "postline retry ${post.id} ${channel}"`);
      continue;
    }
    if (entry?.status === "failed" && entry.attempts >= cfg.publish.maxAttempts) {
      outcomes.push({ post: post.id, channel, result: "blocked", detail: `gave up after ${entry.attempts} attempts: ${entry.error}` });
      continue;
    }
    if (broken.has(post.id)) {
      outcomes.push({ post: post.id, channel, result: "blocked", detail: "post has lint errors" });
      opts.log(`! ${tag}: has lint errors, not publishing`);
      continue;
    }
    const lateBy = (opts.now.getTime() - post.when!.getTime()) / 60_000;
    if (!entry && lateBy > cfg.publish.lateMinutes && !opts.catchUp) {
      outcomes.push({ post: post.id, channel, result: "skipped", detail: `${Math.round(lateBy)} min late` });
      opts.log(`- ${tag}: ${Math.round(lateBy)} min past its slot, skipping (use --catch-up to send anyway)`);
      if (!opts.dryRun) {
        ledger.set(post.id, channel, { status: "skipped", error: "late" }, opts.now);
        ledger.save();
      }
      continue;
    }

    const chCfg = cfg.channels[channel];
    if (!chCfg) continue; // lint already flagged it
    const text = textFor(post, channel);

    if (opts.prepareOnly) {
      ledger.set(post.id, channel, { status: "attempting" }, opts.now);
      ledger.save();
      outcomes.push({ post: post.id, channel, result: "prepared" });
      opts.log(`> ${tag}: prepared; persist the ledger before sending`);
      continue;
    }

    if (opts.dryRun) {
      const img = await mediaFor(post, opts, media);
      opts.log(`~ ${tag}: would publish ${text.length} chars${img ? ` + image (${Math.round(img.bytes.length / 1024)} KB)` : ""}`);
      outcomes.push({ post: post.id, channel, result: "dry-run" });
      continue;
    }

    if (!opts.resumePrepared) {
      ledger.set(post.id, channel, { status: "attempting" }, opts.now);
      ledger.save();
    }
    try {
      const image = await mediaFor(post, opts, media);
      const adapter = createAdapter(channel, chCfg, opts.deps);
      const res = await adapter.publish({ post, channel, text, ...(image === undefined ? {} : { image }) });
      ledger.set(post.id, channel, { status: "published", remoteId: res.id, ...(res.url === undefined ? {} : { url: res.url }) }, new Date());
      outcomes.push({ post: post.id, channel, result: "published", detail: res.url ?? res.id });
      opts.log(`+ ${tag}: ${res.url ?? res.id}`);
      try {
        opts.library?.recordPublished(post.id, {
          channel,
          at: new Date().toISOString(),
          remoteId: res.id,
          ...(res.url === undefined ? {} : { url: res.url }),
        });
      } catch (error) {
        opts.log(`! ${tag}: published, but the library note failed: ${(error as Error).message}`);
      }
    } catch (err) {
      const message = (err as Error).message;
      ledger.set(post.id, channel, { status: "failed", error: message }, new Date());
      outcomes.push({ post: post.id, channel, result: "failed", detail: message });
      opts.log(`x ${tag}: ${message}`);
    }
    ledger.save();
  }
  return outcomes;
}
