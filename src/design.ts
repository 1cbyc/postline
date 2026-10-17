// Design tokens and custom layouts: the "bring your own design system" layer.
//
// Tokens are read from a JSON file in the W3C Design Tokens (DTCG) format
// ({"$value": ...}), the Style Dictionary format ({"value": ...}) or plain
// nested values. Tools such as Tokens Studio and Figma variable exporters
// produce one of these. Brand settings can then point at a token with
// "{color.brand.primary}" instead of repeating the value.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

export type TokenMap = Map<string, string>;

const SAFE_CSS_VALUE = /^[#(),.%+\-\s/'"A-Za-z0-9]+$/;
export const BUILT_IN_LAYOUTS = ["rows", "grid", "statement"] as const;
const LAYOUT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ALIAS = /^\{([^{}]+)\}$/;

export class DesignError extends Error {}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function flatten(node: unknown, path: string[], out: TokenMap): void {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    const value = scalar(node);
    if (value !== undefined && path.length) out.set(path.join("."), value);
    return;
  }
  const record = node as Record<string, unknown>;
  const leaf = "$value" in record ? record.$value : "value" in record && typeof record.value !== "object" ? record.value : undefined;
  if (leaf !== undefined) {
    const value = scalar(leaf);
    if (value !== undefined && path.length) out.set(path.join("."), value);
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (key.startsWith("$")) continue;
    flatten(child, [...path, key], out);
  }
}

/** Resolve "{a.b}" aliases, following chains, rejecting cycles. */
export function resolveAlias(tokens: TokenMap, value: string, label: string, seen: string[] = []): string {
  const match = ALIAS.exec(value.trim());
  if (!match) return value;
  const name = match[1]!.trim();
  if (seen.includes(name)) throw new DesignError(`${label}: token alias cycle ${[...seen, name].join(" -> ")}`);
  const next = tokens.get(name);
  if (next === undefined) throw new DesignError(`${label}: unknown token "{${name}}"`);
  return resolveAlias(tokens, next, label, [...seen, name]);
}

export function parseTokens(json: string, label = "design.tokens"): TokenMap {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new DesignError(`${label} is not valid JSON: ${(error as Error).message}`);
  }
  const raw: TokenMap = new Map();
  flatten(data, [], raw);
  const resolved: TokenMap = new Map();
  for (const [name, value] of raw) resolved.set(name, resolveAlias(raw, value, `${label} ${name}`));
  return resolved;
}

export function loadTokens(file: string): TokenMap {
  return parseTokens(readFileSync(file, "utf8"), file);
}

/** Tokens as CSS custom properties: color.brand.primary -> --color-brand-primary. */
export function tokenCss(tokens: TokenMap): string {
  const lines: string[] = [];
  for (const [name, value] of tokens) {
    if (!SAFE_CSS_VALUE.test(value)) continue;
    const prop = name.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    if (prop) lines.push(`--${prop}:${value};`);
  }
  return lines.length ? `:root{${lines.join("")}}` : "";
}

/** Nested plain object of token values for templates: {{tokens.color.brand.primary}}. */
export function tokenTree(tokens: TokenMap): Record<string, unknown> {
  const tree: Record<string, unknown> = {};
  for (const [name, value] of tokens) {
    const parts = name.split(".");
    let node = tree;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        if (typeof node[part] !== "object") node[part] = value;
      } else {
        if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
        node = node[part] as Record<string, unknown>;
      }
    });
  }
  return tree;
}

/** Finds custom layouts: every <name>.html in the templates folder. */
export function discoverLayouts(dir: string): Record<string, string> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new DesignError(`design.templates folder not found: ${dir}`);
  const layouts: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    if (extname(name).toLowerCase() !== ".html") continue;
    const layout = basename(name, extname(name)).toLowerCase();
    if (!LAYOUT_NAME.test(layout)) throw new DesignError(`template "${name}": layout names use lowercase letters, numbers and hyphens`);
    layouts[layout] = join(dir, name);
  }
  return layouts;
}
