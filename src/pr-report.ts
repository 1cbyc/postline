// `postline pr-report`: what a pull request changes, as Markdown for a PR
// comment. Changed posts get their rendered card, per-channel lengths and lint
// results; the GitHub Action in action.yml posts it.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { Config } from "./config.js";
import { displayPath, textFor, type Post } from "./content.js";
import { lint, type Finding } from "./lint.js";
import { channelLimit } from "./adapters/index.js";
import { graphemeLength } from "./text.js";
import { humanLabel } from "./time.js";

/** A design change restyles every card; past this many, the report lists the rest. */
export const RESTYLE_LIMIT = 12;

export interface ChangeSet {
  posts: Post[];
  /** Why every post is included, when the config or design files changed. */
  restyled?: string;
}

/** Project-relative paths changed between `base` and HEAD. */
export function gitChanges(root: string, base: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", "--diff-filter=AMR", "--relative", base, "HEAD", "--", "."], {
    cwd: root,
    encoding: "utf8",
  });
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Which posts to show for a list of changed project-relative paths. */
export function selectChanges(cfg: Config, posts: Post[], changed: string[]): ChangeSet {
  const files = new Set(changed.map((path) => resolve(cfg.root, path)));
  const designFiles = [cfg.file, cfg.design.tokensFile, cfg.design.stylesheet, ...Object.values(cfg.design.layouts)].filter(
    (f): f is string => typeof f === "string",
  );
  const logo = cfg.brand.logo ? resolve(cfg.root, cfg.brand.logo) : undefined;
  const restyle = [...designFiles, ...(logo ? [logo] : [])].find((f) => files.has(f));
  if (restyle) {
    return { posts, restyled: `${displayPath(cfg, restyle)} changed, so every card may look different` };
  }
  return { posts: posts.filter((p) => files.has(resolve(p.file))) };
}

export interface RenderedImage {
  /** File name in the images folder. */
  name: string;
  /** Where the comment loads it from; omitted when images aren't published. */
  url?: string;
}

export interface ReportInput {
  cfg: Config;
  /** Every post, so cross-post lint rules (slot collisions, topic repeats) still apply. */
  posts: Post[];
  changes: ChangeSet;
  images: Map<string, RenderedImage>;
  renderErrors: Map<string, string>;
  sha?: string;
}

export interface Report {
  markdown: string;
  changed: number;
  errors: number;
  warnings: number;
}

function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}text\n${text}\n${ticks}`;
}

/** Text that is safe inside a Markdown table cell or heading. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/\r?\n/g, " ");
}

function attr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function buildReport(input: ReportInput): Report {
  const { cfg, posts, changes } = input;
  const all = lint(cfg, posts);
  const shown = changes.posts.slice(0, changes.restyled ? RESTYLE_LIMIT : undefined);
  const mine = (post: Post): Finding[] => all.filter((f) => f.post === post);
  const findings = changes.posts.flatMap(mine);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;

  const lines: string[] = ["### postline preview", ""];
  if (changes.posts.length === 0) {
    lines.push("No posts changed in this pull request.", "", "<!-- postline-no-changes -->");
    return { markdown: lines.join("\n") + "\n", changed: 0, errors: 0, warnings: 0 };
  }
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  lines.push(
    `${count(changes.posts.length, "post")} · ${errors ? `**${count(errors, "error")}**` : "0 errors"} · ${count(warnings, "warning")}`,
    "",
  );
  if (changes.restyled) lines.push(`> ${changes.restyled}.`, "");

  for (const post of shown) {
    const when = post.when ? `${humanLabel(post.when, cfg.timezone)} (${cfg.timezone})` : "unscheduled";
    lines.push(`#### \`${post.id}\``, "", `${cell(when)} · ${post.status} · ${cell(post.channels.join(", ") || "no channels")}`, "");

    const image = input.images.get(post.id);
    const renderError = input.renderErrors.get(post.id);
    if (image?.url) {
      lines.push(`<img src="${attr(image.url)}" width="360" alt="${attr(post.alt ?? post.card?.headline.join(" ") ?? post.id)}">`, "");
    } else if (image) {
      lines.push(`Card rendered to \`${cell(image.name)}\`.`, "");
    } else if (renderError) {
      lines.push(`The card did not render: \`${cell(renderError.split("\n")[0] ?? renderError)}\``, "");
    }

    if (post.channels.length) {
      lines.push("| Channel | Length |", "| --- | --- |");
      for (const name of post.channels) {
        const ch = cfg.channels[name];
        const text = textFor(post, name);
        if (!ch) {
          lines.push(`| ${cell(name)} | not in the config |`);
          continue;
        }
        const limit = channelLimit(ch);
        const n = limit.graphemes ? graphemeLength(text) : text.length;
        const value = `${n.toLocaleString("en")} / ${limit.max.toLocaleString("en")}`;
        lines.push(`| ${cell(name)} | ${n > limit.max ? `**${value}** over` : value} |`);
      }
      lines.push("");
    }

    const own = mine(post);
    if (own.length) {
      for (const f of own) lines.push(`- ${f.severity === "error" ? "**error**" : "warning"} \`${f.rule}\`: ${cell(f.message)}`);
    } else {
      lines.push("No lint problems.");
    }
    lines.push("");

    const texts = post.channels.map((name) => [name, textFor(post, name)] as const);
    const distinct = new Map<string, string[]>();
    for (const [name, text] of texts) distinct.set(text, [...(distinct.get(text) ?? []), name]);
    if (distinct.size) {
      lines.push("<details><summary>Post text</summary>", "");
      for (const [text, names] of distinct) lines.push(`**${cell(names.join(", "))}**`, "", fence(text), "");
      lines.push("</details>", "");
    }
  }
  if (changes.posts.length > shown.length) {
    lines.push(`…and ${changes.posts.length - shown.length} more: ${changes.posts.slice(shown.length).map((p) => `\`${p.id}\``).join(", ")}`, "");
  }
  lines.push(`<sub>Rendered by postline${input.sha ? ` for ${input.sha.slice(0, 7)}` : ""}. Run \`postline preview\` to see every channel locally.</sub>`);
  return { markdown: lines.join("\n") + "\n", changed: changes.posts.length, errors, warnings };
}

/** Copy a rendered card into the images folder under a content-addressed name. */
export function keepImage(post: Post, file: string, hash: string, dir: string, urlTemplate?: string): RenderedImage {
  mkdirSync(dir, { recursive: true });
  const name = `${post.id}-${hash.slice(0, 12)}${extname(file) || ".png"}`;
  copyFileSync(file, join(dir, name));
  return { name, ...(urlTemplate ? { url: urlTemplate.replaceAll("{file}", encodeURIComponent(name)) } : {}) };
}
