import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import YAML from "yaml";
import type { Adapter, AdapterDeps, PublishInput, PublishResult } from "./types.js";
import { PublishError } from "./types.js";
import type { ChannelConfig } from "../config.js";
import { firstLine } from "../text.js";

/**
 * Writes the post as a Markdown file with front matter. Point it at a static
 * site's content folder (Astro, Hugo, Next, Jekyll) to cross-post to a blog,
 * or at an archive folder to keep a copy of everything that went out.
 */
export function files(name: string, cfg: ChannelConfig, deps: AdapterDeps): Adapter {
  if (!cfg.dir) throw new PublishError(`${name}: set "dir"`);
  const dir = resolve(deps.root, String(cfg.dir));
  const assetsDir = resolve(deps.root, String(cfg.assetsDir ?? cfg.dir));
  const assetsUrl = cfg.assetsUrl ? String(cfg.assetsUrl).replace(/\/$/, "") : undefined;

  return {
    async publish({ post, text, image }: PublishInput): Promise<PublishResult> {
      mkdirSync(dir, { recursive: true });
      const fm: Record<string, unknown> = {
        title: firstLine(text).replace(/^#+\s*/, ""),
        date: post.when?.toISOString(),
        topic: post.topic,
      };
      if (image) {
        mkdirSync(assetsDir, { recursive: true });
        const ext = image.mime === "image/png" ? "png" : "jpg";
        const imgFile = join(assetsDir, `${post.id}.${ext}`);
        writeFileSync(imgFile, image.bytes);
        fm.image = assetsUrl ? `${assetsUrl}/${post.id}.${ext}` : relative(dir, imgFile);
        fm.imageAlt = image.alt;
      }
      const file = join(dir, `${post.id}.md`);
      const clean = Object.fromEntries(Object.entries(fm).filter(([, v]) => v != null));
      writeFileSync(file, `---\n${YAML.stringify(clean)}---\n\n${text}\n`);
      return { id: relative(deps.root, file) };
    },
  };
}
