import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, extname, resolve } from "node:path";
import YAML from "yaml";
import type { Config, CardSize } from "./config.js";
import { parseLocal } from "./time.js";

export interface CardItem {
  title: string;
  note?: string;
  label?: string;
  chip?: string;
}

export interface CardSpec {
  layout: "rows" | "grid" | "statement";
  eyebrow?: string;
  headline: string[];
  subline?: string;
  items: CardItem[];
  footer?: string;
  size?: CardSize;
}

export interface Post {
  id: string;
  file: string;
  at?: string;
  when?: Date;
  channels: string[];
  status: "draft" | "ready";
  topic?: string;
  body: string;
  variants: Record<string, string>;
  card?: CardSpec;
  image?: string;
  alt?: string;
  problems: string[];
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function splitFrontMatter(src: string): { data: any; body: string } {
  const text = src.replace(/^﻿/, "");
  const m = FM_RE.exec(text);
  if (!m) return { data: {}, body: text };
  return { data: YAML.parse(m[1]!) ?? {}, body: m[2]! };
}

export function parsePost(src: string, file: string, cfg: Config): Post {
  const problems: string[] = [];
  let data: any = {};
  let body = "";
  try {
    ({ data, body } = splitFrontMatter(src));
  } catch (err) {
    problems.push(`front matter is not valid YAML: ${(err as Error).message}`);
  }

  const id = String(data.id ?? basename(file, extname(file)));
  const at = data.at != null ? String(data.at) : undefined;
  let when: Date | undefined;
  if (at) {
    try {
      when = parseLocal(at, cfg.timezone);
    } catch (err) {
      problems.push((err as Error).message);
    }
  }

  const channels: string[] = Array.isArray(data.channels)
    ? data.channels.map(String)
    : data.channels
      ? [String(data.channels)]
      : Object.keys(cfg.channels);

  const status = data.status === "draft" ? "draft" : "ready";

  let card: CardSpec | undefined;
  if (data.card) {
    const c = data.card;
    const headline = Array.isArray(c.headline) ? c.headline.map(String) : c.headline ? [String(c.headline)] : [];
    if (headline.length === 0) problems.push("card.headline is required when card is set");
    const layout = c.layout ?? (c.items?.length ? "rows" : "statement");
    if (!["rows", "grid", "statement"].includes(layout)) problems.push(`card.layout "${layout}" is not rows, grid or statement`);
    card = {
      layout,
      eyebrow: c.eyebrow,
      headline,
      subline: c.subline,
      items: (c.items ?? []).map((it: any) =>
        typeof it === "string" ? { title: it } : { title: String(it.title ?? ""), note: it.note, label: it.label, chip: it.chip },
      ),
      footer: c.footer,
      size: c.size,
    };
  }

  return {
    id,
    file,
    at,
    when,
    channels,
    status,
    topic: data.topic,
    body: body.trim(),
    variants: data.variants ?? {},
    card,
    image: data.image ? resolve(file, "..", String(data.image)) : undefined,
    alt: data.alt,
    problems,
  };
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

export function loadPosts(cfg: Config): Post[] {
  return walk(cfg.postsDir).map((f) => parsePost(readFileSync(f, "utf8"), f, cfg));
}

export function textFor(post: Post, channel: string): string {
  return (post.variants[channel] ?? post.body).trim();
}

export function displayPath(cfg: Config, file: string): string {
  return relative(cfg.root, file) || file;
}
