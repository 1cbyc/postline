import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, extname, resolve } from "node:path";
import YAML from "yaml";
import type { Config, CardSize } from "./config.js";
import { isSafeFileStem } from "./path.js";
import { parseLocal } from "./time.js";

type UnknownRecord = Record<string, unknown>;

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
const CARD_SIZES = ["square", "landscape", "portrait"] as const;
const CARD_LAYOUTS = ["rows", "grid", "statement"] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, label: string, problems: string[]): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    problems.push(`${label} must be a string`);
    return undefined;
  }
  return value;
}

function parseVariants(value: unknown, problems: string[]): Record<string, string> {
  if (value == null) return {};
  if (!isRecord(value)) {
    problems.push("variants must be a mapping of channel names to text");
    return {};
  }
  const variants: Record<string, string> = {};
  for (const [channel, text] of Object.entries(value)) {
    if (typeof text !== "string") problems.push(`variants.${channel} must be a string`);
    else variants[channel] = text;
  }
  return variants;
}

function parseCardItem(value: unknown, index: number, problems: string[]): CardItem | undefined {
  if (typeof value === "string") return { title: value };
  if (!isRecord(value)) {
    problems.push(`card.items[${index}] must be a string or mapping`);
    return undefined;
  }
  const title = optionalString(value.title, `card.items[${index}].title`, problems);
  if (!title) problems.push(`card.items[${index}].title is required`);
  const note = optionalString(value.note, `card.items[${index}].note`, problems);
  const label = optionalString(value.label, `card.items[${index}].label`, problems);
  const chip = optionalString(value.chip, `card.items[${index}].chip`, problems);
  return {
    title: title ?? "",
    ...(note === undefined ? {} : { note }),
    ...(label === undefined ? {} : { label }),
    ...(chip === undefined ? {} : { chip }),
  };
}

function parseCard(value: unknown, problems: string[]): CardSpec | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    problems.push("card must be a mapping");
    return undefined;
  }
  const headlineValue = value.headline;
  const headline = Array.isArray(headlineValue)
    ? headlineValue.filter((line): line is string => {
        if (typeof line === "string") return true;
        problems.push("card.headline entries must be strings");
        return false;
      })
    : typeof headlineValue === "string"
      ? [headlineValue]
      : [];
  if (headline.length === 0) problems.push("card.headline is required when card is set");

  const itemsValue = value.items ?? [];
  if (!Array.isArray(itemsValue)) problems.push("card.items must be a list");
  const items = (Array.isArray(itemsValue) ? itemsValue : [])
    .map((item, index) => parseCardItem(item, index, problems))
    .filter((item): item is CardItem => item !== undefined);

  const defaultLayout = items.length > 0 ? "rows" : "statement";
  const layoutValue = value.layout ?? defaultLayout;
  const layout = CARD_LAYOUTS.includes(layoutValue as CardSpec["layout"])
    ? (layoutValue as CardSpec["layout"])
    : defaultLayout;
  if (layoutValue !== layout) problems.push(`card.layout "${String(layoutValue)}" is not rows, grid or statement`);

  const sizeValue = value.size;
  const size = CARD_SIZES.includes(sizeValue as CardSize) ? (sizeValue as CardSize) : undefined;
  if (sizeValue != null && !size) problems.push(`card.size "${String(sizeValue)}" is not square, landscape or portrait`);

  const eyebrow = optionalString(value.eyebrow, "card.eyebrow", problems);
  const subline = optionalString(value.subline, "card.subline", problems);
  const footer = optionalString(value.footer, "card.footer", problems);
  return {
    layout,
    headline,
    items,
    ...(eyebrow === undefined ? {} : { eyebrow }),
    ...(subline === undefined ? {} : { subline }),
    ...(footer === undefined ? {} : { footer }),
    ...(size === undefined ? {} : { size }),
  };
}

export function splitFrontMatter(src: string): { data: unknown; body: string } {
  const text = src.replace(/^﻿/, "");
  const match = FM_RE.exec(text);
  if (!match) return { data: {}, body: text };
  return { data: YAML.parse(match[1]!) ?? {}, body: match[2]! };
}

export function parsePost(src: string, file: string, cfg: Config): Post {
  const problems: string[] = [];
  let parsed: unknown = {};
  let body = "";
  try {
    ({ data: parsed, body } = splitFrontMatter(src));
  } catch (error) {
    problems.push(`front matter is not valid YAML: ${(error as Error).message}`);
  }
  const data = isRecord(parsed) ? parsed : {};
  if (!isRecord(parsed)) problems.push("front matter must be a mapping");

  const fallbackId = basename(file, extname(file));
  const id = optionalString(data.id, "id", problems) ?? fallbackId;
  if (!isSafeFileStem(id)) problems.push("id must start with a letter or number and contain only letters, numbers, dot, underscore or hyphen");

  const at = optionalString(data.at, "at", problems);
  let when: Date | undefined;
  if (at) {
    try {
      when = parseLocal(at, cfg.timezone);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  let channels: string[];
  if (data.channels == null) channels = Object.keys(cfg.channels);
  else if (typeof data.channels === "string") channels = [data.channels];
  else if (Array.isArray(data.channels) && data.channels.every((channel) => typeof channel === "string" && channel !== "")) {
    channels = data.channels;
  } else {
    problems.push("channels must be a channel name or list of channel names");
    channels = [];
  }
  if (new Set(channels).size !== channels.length) problems.push("channels must not contain duplicates");

  let status: Post["status"] = "ready";
  if (data.status === "draft") status = "draft";
  else if (data.status != null && data.status !== "ready") {
    problems.push(`status "${String(data.status)}" is not draft or ready`);
    status = "draft";
  }

  const topic = optionalString(data.topic, "topic", problems);
  const imageValue = optionalString(data.image, "image", problems);
  const alt = optionalString(data.alt, "alt", problems);
  const card = parseCard(data.card, problems);
  return {
    id,
    file,
    ...(at === undefined ? {} : { at }),
    ...(when === undefined ? {} : { when }),
    channels,
    status,
    ...(topic === undefined ? {} : { topic }),
    body: body.trim(),
    variants: parseVariants(data.variants, problems),
    ...(card === undefined ? {} : { card }),
    ...(imageValue === undefined ? {} : { image: resolve(file, "..", imageValue) }),
    ...(alt === undefined ? {} : { alt }),
    problems,
  };
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out.sort();
}

export function loadPosts(cfg: Config): Post[] {
  return walk(cfg.postsDir).map((file) => parsePost(readFileSync(file, "utf8"), file, cfg));
}

export function textFor(post: Post, channel: string): string {
  return (post.variants[channel] ?? post.body).trim();
}

export function displayPath(cfg: Config, file: string): string {
  return relative(cfg.root, file) || file;
}
