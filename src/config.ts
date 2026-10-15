import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import YAML from "yaml";
import { isPathInside } from "./path.js";
import { isValidTimeZone, WEEKDAYS, type Weekday } from "./time.js";

export type Tone = "ok" | "warn" | "bad" | "neutral";
export type CardSize = "square" | "landscape" | "portrait";
type UnknownRecord = Record<string, unknown>;

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

interface ChannelBase {
  maxChars?: number;
}

export interface LinkedInChannelConfig extends ChannelBase {
  type: "linkedin";
  organization?: string;
  person?: string;
  version: string;
  tokenEnv: string;
}

export interface BlueskyChannelConfig extends ChannelBase {
  type: "bluesky";
  service: string;
  lang: string;
  identifierEnv: string;
  passwordEnv: string;
}

export interface MastodonChannelConfig extends ChannelBase {
  type: "mastodon";
  instance: string;
  visibility: "public" | "unlisted" | "private" | "direct";
  lang: string;
  tokenEnv: string;
  pollMs: number;
}

export interface WebhookChannelConfig extends ChannelBase {
  type: "webhook";
  url: string;
  secretEnv: string;
}

export interface FilesChannelConfig extends ChannelBase {
  type: "files";
  dir: string;
  assetsDir?: string;
  assetsUrl?: string;
}

export type ChannelConfig =
  | LinkedInChannelConfig
  | BlueskyChannelConfig
  | MastodonChannelConfig
  | WebhookChannelConfig
  | FilesChannelConfig;

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
  publish: { lateMinutes: number; maxAttempts: number; requestTimeoutMs: number };
  channels: Record<string, ChannelConfig>;
  rules: Rules;
}

const CHANNEL_TYPES = ["linkedin", "bluesky", "mastodon", "webhook", "files"] as const;
const CARD_SIZES = ["square", "landscape", "portrait"] as const;
const TONES = ["ok", "warn", "bad", "neutral"] as const;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CHANNEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ConfigError(`${label} must be a mapping`);
  return value as UnknownRecord;
}

function optionalRecord(value: unknown, label: string): UnknownRecord {
  return value == null ? {} : record(value, label);
}

function stringValue(value: unknown, label: string, fallback?: string): string {
  if (value == null && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") throw new ConfigError(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value == null ? undefined : stringValue(value, label);
}

function booleanValue(value: unknown, label: string, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new ConfigError(`${label} must be true or false`);
  return value;
}

function numberValue(
  value: unknown,
  label: string,
  fallback: number,
  options: { min: number; max: number; integer?: boolean },
): number {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ConfigError(`${label} must be a finite number`);
  if (options.integer && !Number.isInteger(value)) throw new ConfigError(`${label} must be an integer`);
  if (value < options.min || value > options.max) {
    throw new ConfigError(`${label} must be between ${options.min} and ${options.max}`);
  }
  return value;
}

function stringArray(value: unknown, label: string, fallback: string[] = []): string[] {
  if (value == null) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new ConfigError(`${label} must be a list of non-empty strings`);
  }
  return value;
}

function tuple(value: unknown, label: string, fallback: [string, string]): [string, string] {
  if (value == null) return fallback;
  if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== "string" || item === "")) {
    throw new ConfigError(`${label} must be [fill, text]`);
  }
  if (value.some((item) => !/^[#(),.%+\-\sA-Za-z0-9]+$/.test(item as string))) {
    throw new ConfigError(`${label} contains unsafe CSS characters`);
  }
  return [value[0] as string, value[1] as string];
}

function httpUrl(value: unknown, label: string): string {
  const text = stringValue(value, label);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new ConfigError(`${label} must be an absolute HTTP or HTTPS URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ConfigError(`${label} must use HTTP or HTTPS`);
  return text;
}

function language(value: unknown, label: string, fallback: string): string {
  const lang = stringValue(value, label, fallback);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang)) throw new ConfigError(`${label} must be a language tag such as en or en-US`);
  return lang;
}

function cssColor(value: unknown, label: string, fallback: string): string {
  const color = stringValue(value, label, fallback);
  if (!/^[#(),.%+\-\sA-Za-z0-9]+$/.test(color)) throw new ConfigError(`${label} contains unsafe CSS characters`);
  return color;
}

function projectPath(root: string, value: unknown, label: string, fallback: string): string {
  const path = resolve(root, stringValue(value, label, fallback));
  if (!isPathInside(root, path)) throw new ConfigError(`${label} must stay inside the project root`);
  return path;
}

function envName(value: unknown, label: string, fallback: string): string {
  const name = stringValue(value, label, fallback);
  if (!ENV_NAME.test(name)) throw new ConfigError(`${label} must be an environment variable name`);
  return name;
}

function optionalMaxChars(value: unknown, label: string): number | undefined {
  return value == null ? undefined : numberValue(value, label, 1, { min: 1, max: 1_000_000, integer: true });
}

function normalizeChannel(name: string, input: unknown): ChannelConfig {
  if (!CHANNEL_NAME.test(name)) throw new ConfigError(`channel name "${name}" is not safe`);
  const raw = record(input, `channels.${name}`);
  const typeValue = raw.type ?? name;
  if (typeof typeValue !== "string" || !CHANNEL_TYPES.includes(typeValue as (typeof CHANNEL_TYPES)[number])) {
    throw new ConfigError(`channels.${name}: unknown type "${String(typeValue)}"`);
  }
  const type = typeValue as ChannelConfig["type"];
  const maxChars = optionalMaxChars(raw.maxChars, `channels.${name}.maxChars`);
  const common = maxChars === undefined ? {} : { maxChars };

  switch (type) {
    case "linkedin": {
      const organization = optionalString(raw.organization, `channels.${name}.organization`);
      const person = optionalString(raw.person, `channels.${name}.person`);
      if (Boolean(organization) === Boolean(person)) {
        throw new ConfigError(`channels.${name} must set exactly one of organization or person`);
      }
      const version = stringValue(raw.version, `channels.${name}.version`, "202609");
      if (!/^20\d{4}$/.test(version)) throw new ConfigError(`channels.${name}.version must be YYYYMM`);
      const tokenEnv = envName(raw.tokenEnv, `channels.${name}.tokenEnv`, "LINKEDIN_ACCESS_TOKEN");
      if (organization) return { ...common, type: "linkedin", organization, version, tokenEnv };
      if (person) return { ...common, type: "linkedin", person, version, tokenEnv };
      throw new ConfigError(`channels.${name} must set exactly one of organization or person`);
    }
    case "bluesky":
      return {
        ...common,
        type: "bluesky",
        service: raw.service == null ? "https://bsky.social" : httpUrl(raw.service, `channels.${name}.service`),
        lang: language(raw.lang, `channels.${name}.lang`, "en"),
        identifierEnv: envName(raw.identifierEnv, `channels.${name}.identifierEnv`, "BLUESKY_IDENTIFIER"),
        passwordEnv: envName(raw.passwordEnv, `channels.${name}.passwordEnv`, "BLUESKY_APP_PASSWORD"),
      };
    case "mastodon":
      return {
        ...common,
        type: "mastodon",
        instance: httpUrl(raw.instance, `channels.${name}.instance`),
        visibility: (() => {
          const visibility = stringValue(raw.visibility, `channels.${name}.visibility`, "public");
          if (!["public", "unlisted", "private", "direct"].includes(visibility)) {
            throw new ConfigError(`channels.${name}.visibility must be public, unlisted, private or direct`);
          }
          return visibility as MastodonChannelConfig["visibility"];
        })(),
        lang: language(raw.lang, `channels.${name}.lang`, "en"),
        tokenEnv: envName(raw.tokenEnv, `channels.${name}.tokenEnv`, "MASTODON_ACCESS_TOKEN"),
        pollMs: numberValue(raw.pollMs, `channels.${name}.pollMs`, 1000, { min: 100, max: 60_000, integer: true }),
      };
    case "webhook":
      return {
        ...common,
        type: "webhook",
        url: httpUrl(raw.url, `channels.${name}.url`),
        secretEnv: envName(raw.secretEnv, `channels.${name}.secretEnv`, "POSTLINE_WEBHOOK_SECRET"),
      };
    case "files":
      return {
        ...common,
        type: "files",
        dir: stringValue(raw.dir, `channels.${name}.dir`),
        ...(raw.assetsDir == null ? {} : { assetsDir: stringValue(raw.assetsDir, `channels.${name}.assetsDir`) }),
        ...(raw.assetsUrl == null ? {} : { assetsUrl: stringValue(raw.assetsUrl, `channels.${name}.assetsUrl`) }),
      };
  }
}

export function findConfig(cwd: string, explicit?: string): string {
  if (explicit) {
    const configPath = resolve(cwd, explicit);
    if (!existsSync(configPath)) throw new ConfigError(`config not found: ${configPath}`);
    return configPath;
  }
  for (const name of ["postline.config.yaml", "postline.config.yml"]) {
    const configPath = join(cwd, name);
    if (existsSync(configPath)) return configPath;
  }
  throw new ConfigError(`no postline.config.yaml in ${cwd} (run "postline init" to create one)`);
}

export function loadConfig(cwd: string, explicit?: string): Config {
  const file = findConfig(cwd, explicit);
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(`could not parse ${file}: ${(error as Error).message}`);
  }
  return normalizeConfig(raw ?? {}, resolve(file, ".."), file);
}

export function normalizeConfig(input: unknown, root: string, file = "<inline>"): Config {
  const raw = record(input, "config");
  const brandRaw = optionalRecord(raw.brand, "brand");
  const scheduleRaw = optionalRecord(raw.schedule, "schedule");
  const cardRaw = optionalRecord(raw.card, "card");
  const publishRaw = optionalRecord(raw.publish, "publish");
  const rulesRaw = optionalRecord(raw.rules, "rules");
  const colorsRaw = optionalRecord(brandRaw.colors, "brand.colors");
  const fontInput = brandRaw.font;
  const fontRaw = typeof fontInput === "string" ? { family: fontInput } : optionalRecord(fontInput, "brand.font");

  const timezone = stringValue(raw.timezone, "timezone", "UTC");
  if (!isValidTimeZone(timezone)) throw new ConfigError(`unknown timezone "${timezone}"`);

  const days = stringArray(scheduleRaw.days, "schedule.days", ["mon", "tue", "wed", "thu", "fri"]);
  if (days.length === 0) throw new ConfigError("schedule.days must not be empty");
  const normalizedDays = days.map((day) => day.slice(0, 3).toLowerCase());
  if (normalizedDays.some((day) => !WEEKDAYS.includes(day as Weekday))) throw new ConfigError("schedule.days contains an unknown day");
  if (new Set(normalizedDays).size !== normalizedDays.length) throw new ConfigError("schedule.days must not contain duplicates");

  const times = stringArray(scheduleRaw.times, "schedule.times", ["09:00"]);
  if (times.length === 0) throw new ConfigError("schedule.times must not be empty");
  if (times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new ConfigError("schedule.times must use HH:MM in 24-hour time");
  if (new Set(times).size !== times.length) throw new ConfigError("schedule.times must not contain duplicates");

  const weekStartsOnText = stringValue(scheduleRaw.weekStartsOn, "schedule.weekStartsOn", normalizedDays[0] ?? "mon")
    .slice(0, 3)
    .toLowerCase();
  if (!WEEKDAYS.includes(weekStartsOnText as Weekday)) throw new ConfigError(`schedule.weekStartsOn: unknown day "${weekStartsOnText}"`);

  const channelRaw = optionalRecord(raw.channels, "channels");
  const channels = Object.fromEntries(Object.entries(channelRaw).map(([name, value]) => [name, normalizeChannel(name, value)]));

  const sizeValue = stringValue(cardRaw.size, "card.size", "square");
  if (!CARD_SIZES.includes(sizeValue as CardSize)) throw new ConfigError("card.size must be square, landscape or portrait");
  const formatValue = stringValue(cardRaw.format, "card.format", "png");
  if (formatValue !== "png" && formatValue !== "jpeg") throw new ConfigError("card.format must be png or jpeg");

  const colors: BrandColors = {
    background: cssColor(colorsRaw.background, "brand.colors.background", DEFAULT_COLORS.background),
    panel: cssColor(colorsRaw.panel, "brand.colors.panel", DEFAULT_COLORS.panel),
    border: cssColor(colorsRaw.border, "brand.colors.border", DEFAULT_COLORS.border),
    text: cssColor(colorsRaw.text, "brand.colors.text", DEFAULT_COLORS.text),
    muted: cssColor(colorsRaw.muted, "brand.colors.muted", DEFAULT_COLORS.muted),
    accent: cssColor(colorsRaw.accent, "brand.colors.accent", DEFAULT_COLORS.accent),
    ok: tuple(colorsRaw.ok, "brand.colors.ok", DEFAULT_COLORS.ok),
    warn: tuple(colorsRaw.warn, "brand.colors.warn", DEFAULT_COLORS.warn),
    bad: tuple(colorsRaw.bad, "brand.colors.bad", DEFAULT_COLORS.bad),
  };

  const chipRaw = optionalRecord(brandRaw.chips, "brand.chips");
  const chips: Record<string, Tone> = { allowed: "ok", detected: "warn", blocked: "bad" };
  for (const [name, value] of Object.entries(chipRaw)) {
    if (typeof value !== "string" || !TONES.includes(value as Tone)) throw new ConfigError(`brand.chips.${name} must be ok, warn, bad or neutral`);
    chips[name] = value as Tone;
  }

  const fontUrl = fontRaw.url == null ? undefined : httpUrl(fontRaw.url, "brand.font.url");
  const fontFile = optionalString(fontRaw.file, "brand.font.file");
  if (fontUrl && fontFile) throw new ConfigError("brand.font must not set both url and file");
  const brandUrl = optionalString(brandRaw.url, "brand.url");
  const brandLogo = optionalString(brandRaw.logo, "brand.logo");

  return {
    root,
    file,
    timezone,
    brand: {
      name: stringValue(brandRaw.name, "brand.name"),
      ...(brandUrl ? { url: brandUrl } : {}),
      ...(brandLogo ? { logo: brandLogo } : {}),
      showName: booleanValue(brandRaw.showName, "brand.showName", true),
      font: {
        family: stringValue(fontRaw.family, "brand.font.family", "Inter"),
        ...(fontUrl ? { url: fontUrl } : {}),
        ...(fontFile ? { file: fontFile } : {}),
      },
      colors,
      chips,
    },
    schedule: { days: normalizedDays as Weekday[], times, weekStartsOn: weekStartsOnText as Weekday },
    postsDir: projectPath(root, raw.postsDir, "postsDir", "posts"),
    outDir: projectPath(root, raw.outDir, "outDir", "out"),
    stateDir: projectPath(root, raw.stateDir, "stateDir", ".postline"),
    card: {
      size: sizeValue as CardSize,
      format: formatValue,
      quality: numberValue(cardRaw.quality, "card.quality", 90, { min: 1, max: 100, integer: true }),
      scale: numberValue(cardRaw.scale, "card.scale", 2, { min: 1, max: 4 }),
    },
    publish: {
      lateMinutes: numberValue(publishRaw.lateMinutes, "publish.lateMinutes", 180, { min: 0, max: 525_600 }),
      maxAttempts: numberValue(publishRaw.maxAttempts, "publish.maxAttempts", 3, { min: 1, max: 100, integer: true }),
      requestTimeoutMs: numberValue(publishRaw.requestTimeoutMs, "publish.requestTimeoutMs", 30_000, { min: 100, max: 300_000, integer: true }),
    },
    channels,
    rules: {
      maxHashtags: numberValue(rulesRaw.maxHashtags, "rules.maxHashtags", 3, { min: 0, max: 100, integer: true }),
      allowEmoji: booleanValue(rulesRaw.allowEmoji, "rules.allowEmoji", true),
      allowedLinkDomains: stringArray(rulesRaw.allowedLinkDomains, "rules.allowedLinkDomains"),
      hookMaxChars: numberValue(rulesRaw.hookMaxChars, "rules.hookMaxChars", 140, { min: 1, max: 100_000, integer: true }),
      requireImage: booleanValue(rulesRaw.requireImage, "rules.requireImage", false),
      topicCooldownDays: numberValue(rulesRaw.topicCooldownDays, "rules.topicCooldownDays", 14, { min: 0, max: 3650 }),
      bannedPhrases: stringArray(rulesRaw.bannedPhrases, "rules.bannedPhrases"),
    },
  };
}
