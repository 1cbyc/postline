import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config, NotifyConfig, NotifyEvent } from "./config.js";
import { fetchWithTimeout, type AdapterDeps } from "./adapters/types.js";
import { sign } from "./adapters/webhook.js";

export interface Alert {
  event: NotifyEvent;
  /** One line, e.g. "2026-11-03-launch -> linkedin may have gone out". */
  message: string;
  /** Same key, same problem: it is sent at most once per REMIND_MS. */
  key: string;
}

/** A problem that is still there gets one reminder a day, not one every run. */
const REMIND_MS = 24 * 60 * 60 * 1000;
const FORGET_MS = 30 * 24 * 60 * 60 * 1000;
const DISCORD_MAX = 2000;

export interface NotifyDeps extends AdapterDeps {
  now: Date;
  log: (line: string) => void;
}

function stateFile(cfg: Config): string {
  return join(cfg.stateDir, "notified.json");
}

function readState(cfg: Config): Record<string, string> {
  const file = stateFile(cfg);
  if (!existsSync(file)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function writeState(cfg: Config, state: Record<string, string>): void {
  mkdirSync(cfg.stateDir, { recursive: true });
  const file = stateFile(cfg);
  writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
}

export function notifyUrl(notify: NotifyConfig, env: NodeJS.ProcessEnv): string | undefined {
  return notify.url ?? (env[notify.urlEnv] || undefined);
}

function title(alerts: Alert[], brand: string): string {
  const n = alerts.length;
  const doctor = alerts.every((a) => a.event === "doctor");
  return `postline (${brand}): ${n} ${doctor ? "health" : "publishing"} problem${n === 1 ? "" : "s"}`;
}

/** Request for one batch of alerts in the configured format. */
export function alertRequest(
  notify: NotifyConfig,
  alerts: Alert[],
  brand: string,
  env: NodeJS.ProcessEnv,
): { headers: Record<string, string>; body: string } {
  const heading = title(alerts, brand);
  const lines = alerts.map((a) => `${a.event}: ${a.message}`);
  switch (notify.format) {
    case "slack":
      return {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${heading}*\n${lines.map((l) => `• ${l}`).join("\n")}` }),
      };
    case "discord": {
      let content = `**${heading}**\n${lines.map((l) => `- ${l}`).join("\n")}`;
      if (content.length > DISCORD_MAX) content = `${content.slice(0, DISCORD_MAX - 1)}…`;
      // Error text comes from remote responses; it must not be able to ping anyone.
      return { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) };
    }
    case "ntfy":
      // ntfy reads the title from a header; header values must be ASCII.
      return {
        headers: { "Content-Type": "text/plain; charset=utf-8", Title: heading.replace(/[^\x20-\x7e]/g, "?"), Tags: "warning" },
        body: lines.join("\n"),
      };
    case "json": {
      const body = JSON.stringify({ source: "postline", brand, title: heading, alerts: alerts.map(({ event, message }) => ({ event, message })) });
      const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "postline" };
      const secret = env[notify.secretEnv];
      if (secret) headers["X-Postline-Signature"] = sign(secret, body);
      return { headers, body };
    }
  }
}

/**
 * Send alerts the config subscribes to, skipping any sent in the last day.
 * Never throws: an alert that can't be delivered must not stop publishing.
 */
export async function sendAlerts(cfg: Config, alerts: Alert[], deps: NotifyDeps): Promise<number> {
  const notify = cfg.notify;
  if (!notify || alerts.length === 0) return 0;

  const now = deps.now.getTime();
  const state = readState(cfg);
  for (const [key, sent] of Object.entries(state)) {
    if (now - Date.parse(sent) > FORGET_MS) delete state[key];
  }
  const due = alerts.filter((a) => {
    const sent = state[a.key];
    return notify.on.includes(a.event) && !(sent && now - Date.parse(sent) < REMIND_MS);
  });
  if (due.length === 0) return 0;
  const url = notifyUrl(notify, deps.env);
  if (!url) {
    deps.log(`! notify: ${notify.urlEnv} is not set, so ${due.length} alert${due.length === 1 ? " was" : "s were"} not sent`);
    return 0;
  }

  try {
    const { headers, body } = alertRequest(notify, due, cfg.brand.name, deps.env);
    const res = await fetchWithTimeout(deps, url, { method: "POST", headers, body }, "notify");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    deps.log(`! notify: could not send ${due.length} alert${due.length === 1 ? "" : "s"}: ${(error as Error).message}`);
    return 0;
  }
  for (const a of due) state[a.key] = deps.now.toISOString();
  try {
    writeState(cfg, state);
  } catch (error) {
    deps.log(`! notify: sent, but could not record it: ${(error as Error).message}`);
  }
  return due.length;
}
