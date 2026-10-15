import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import YAML from "yaml";
import { isValidTimeZone, WEEKDAYS, type Weekday } from "./time.js";

export type Tone = "ok" | "warn" | "bad" | "neutral";

export interface BrandColors {
  background: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  ok: [string, string];
  warn: [string, string];
  bad: [string, string];
}

export interface Brand {
  name: string;
  url?: string;
  logo?: string;
  showName: boolean;
  font: { family: string; url?: string; file?: string };
  colors: BrandColors;
  chips: Record<string, Tone>;
}

export interface Rules {
  maxHashtags: number;
  allowEmoji: boolean;
  allowedLinkDomains: string[];
  hookMaxChars: number;
  requireImage: boolean;
  topicCooldownDays: number;
  bannedPhrases: string[];
}

export interface ChannelConfig {
  type: "linkedin" | "bluesky" | "mastodon" | "webhook" | "files";
  [key: string]: unknown;
}

export interface Config {
  root: string;
  file: string;
  brand: Brand;
  timezone: string;
  schedule: { days: Weekday[]; times: string[]; weekStartsOn: Weekday };
  postsDir: string;
  outDir: string;
  stateDir: string;
  card: { size: CardSize; format: "png" | "jpeg"; quality: number; scale: number };
  publish: { lateMinutes: number; maxAttempts: number };
  channels: Record<string, ChannelConfig>;
  rules: Rules;
}

export type CardSize = "square" | "landscape" | "portrait";

const CHANNEL_TYPES = new Set(["linkedin", "bluesky", "mastodon", "webhook", "files"]);

const DEFAULT_COLORS: BrandColors = {
  background: "#0f1115",
  panel: "#161a21",
  border: "#2a303b",
  text: "#eef1f5",
  muted: "#98a1ae",
  accent: "#7cc4ff",
  ok: ["#1f6f4a", "#7fd3a5"],
  warn: ["#8a5a10", "#f0c46a"],
  bad: ["#a83a2c", "#f3907f"],
};

export class ConfigError extends Error {}

export function findConfig(cwd: string, explicit?: string): string {
  if (explicit) {
    const p = resolve(cwd, explicit);
    if (!existsSync(p)) throw new ConfigError(`config not found: ${p}`);
    return p;
  }
  for (const name of ["postline.config.yaml", "postline.config.yml"]) {
    const p = join(cwd, name);
    if (existsSync(p)) return p;
  }
  throw new ConfigError(`no postline.config.yaml in ${cwd} (run "postline init" to create one)`);
}

export function loadConfig(cwd: string, explicit?: string): Config {
  const file = findConfig(cwd, explicit);
  const raw = YAML.parse(readFileSync(file, "utf8")) ?? {};
  return normalizeConfig(raw, resolve(file, ".."), file);
}

export function normalizeConfig(raw: any, root: string, file = "<inline>"): Config {
  if (typeof raw !== "object" || raw === null) throw new ConfigError("config must be a mapping");
  const brandRaw = raw.brand ?? {};
  if (!brandRaw.name) throw new ConfigError("brand.name is required");

  const timezone = raw.timezone ?? "UTC";
  if (!isValidTimeZone(timezone)) throw new ConfigError(`unknown timezone "${timezone}"`);

  const colors = { ...DEFAULT_COLORS, ...(brandRaw.colors ?? {}) } as BrandColors;
  for (const tone of ["ok", "warn", "bad"] as const) {
    const v = colors[tone];
    if (!Array.isArray(v) || v.length !== 2) {
      throw new ConfigError(`brand.colors.${tone} must be [fill, text]`);
    }
  }

  const font =
    typeof brandRaw.font === "string"
      ? { family: brandRaw.font }
      : { family: "Inter", ...(brandRaw.font ?? {}) };

  const days: Weekday[] = (raw.schedule?.days ?? ["mon", "tue", "wed", "thu", "fri"]).map((d: string) => {
    const k = String(d).slice(0, 3).toLowerCase() as Weekday;
    if (!WEEKDAYS.includes(k)) throw new ConfigError(`schedule.days: unknown day "${d}"`);
    return k;
  });
  const times: string[] = (raw.schedule?.times ?? ["09:00"]).map((t: unknown) => String(t));
  for (const t of times) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new ConfigError(`schedule.times: "${t}" is not HH:MM`);
  }
  const weekStartsOn = String(raw.schedule?.weekStartsOn ?? days[0] ?? "mon").slice(0, 3).toLowerCase() as Weekday;

  const channels: Record<string, ChannelConfig> = {};
  for (const [name, value] of Object.entries<any>(raw.channels ?? {})) {
    const type = value?.type ?? name;
    if (!CHANNEL_TYPES.has(type)) throw new ConfigError(`channels.${name}: unknown type "${type}"`);
    channels[name] = { ...value, type };
  }

  const size = (raw.card?.size ?? "square") as CardSize;
  if (!["square", "landscape", "portrait"].includes(size)) {
    throw new ConfigError(`card.size must be square, landscape or portrait`);
  }

  return {
    root,
    file,
    timezone,
    brand: {
      name: String(brandRaw.name),
      url: brandRaw.url,
      logo: brandRaw.logo,
      showName: brandRaw.showName ?? true,
      font,
      colors,
      chips: { allowed: "ok", detected: "warn", blocked: "bad", ...(brandRaw.chips ?? {}) },
    },
    schedule: { days, times, weekStartsOn },
    postsDir: resolve(root, raw.postsDir ?? "posts"),
    outDir: resolve(root, raw.outDir ?? "out"),
    stateDir: resolve(root, raw.stateDir ?? ".postline"),
    card: {
      size,
      format: raw.card?.format === "jpeg" ? "jpeg" : "png",
      quality: Number(raw.card?.quality ?? 90),
      scale: Number(raw.card?.scale ?? 2),
    },
    publish: {
      lateMinutes: Number(raw.publish?.lateMinutes ?? 180),
      maxAttempts: Number(raw.publish?.maxAttempts ?? 3),
    },
    channels,
    rules: {
      maxHashtags: Number(raw.rules?.maxHashtags ?? 3),
      allowEmoji: raw.rules?.allowEmoji ?? true,
      allowedLinkDomains: raw.rules?.allowedLinkDomains ?? [],
      hookMaxChars: Number(raw.rules?.hookMaxChars ?? 140),
      requireImage: raw.rules?.requireImage ?? false,
      topicCooldownDays: Number(raw.rules?.topicCooldownDays ?? 14),
      bannedPhrases: raw.rules?.bannedPhrases ?? [],
    },
  };
}
