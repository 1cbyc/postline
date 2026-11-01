import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import type { ChannelConfig, Config, LinkedInChannelConfig } from "./config.js";
import type { Post } from "./content.js";
import { lint } from "./lint.js";
import { Ledger } from "./ledger.js";
import { humanLabel } from "./time.js";
import { notifyUrl, type Alert } from "./notify.js";
import { fetchWithTimeout, type AdapterDeps, type FetchLike } from "./adapters/types.js";

export type Level = "ok" | "info" | "warn" | "error";

export interface Check {
  level: Level;
  area: string;
  message: string;
}

export interface DoctorOptions {
  cfg: Config;
  posts: Post[];
  now: Date;
  env: NodeJS.ProcessEnv;
  /** Running postline version, compared with the one the workflow installs. */
  version: string;
  /** Omit to skip every network call. */
  fetch?: FetchLike;
  requestTimeoutMs?: number;
  /** Starts and stops Chromium; resolves to an error message, or undefined when it works. */
  launchChromium?: () => Promise<string | undefined>;
}

const DAY_MS = 86_400_000;
const TOKEN_WARN_DAYS = 14;
const DRAFT_WARN_MS = 48 * 60 * 60 * 1000;
const LINKEDIN_API = "https://api.linkedin.com/rest";

/** Whole months between a LinkedIn YYYYMM version and now. */
export function linkedInVersionAge(version: string, now: Date): number {
  const year = Number(version.slice(0, 4));
  const month = Number(version.slice(4, 6));
  return (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month);
}

function linkedInChecks(name: string, ch: LinkedInChannelConfig, now: Date): Check[] {
  const out: Check[] = [];
  const age = linkedInVersionAge(ch.version, now);
  if (age >= 12) {
    out.push({ level: "error", area: name, message: `API version ${ch.version} is ${age} months old; LinkedIn retires versions after about a year. Set a newer "version:"` });
  } else if (age >= 10) {
    out.push({ level: "warn", area: name, message: `API version ${ch.version} is ${age} months old and will be retired soon. Set a newer "version:"` });
  }
  if (ch.tokenExpires) {
    const days = Math.floor((Date.parse(`${ch.tokenExpires}T00:00:00Z`) - now.getTime()) / DAY_MS);
    if (days < 0) out.push({ level: "error", area: name, message: `access token expired on ${ch.tokenExpires}. Create a new one and update tokenExpires` });
    else if (days <= TOKEN_WARN_DAYS) out.push({ level: "warn", area: name, message: `access token expires in ${days} day${days === 1 ? "" : "s"} (${ch.tokenExpires}). Refresh it before then` });
    else out.push({ level: "ok", area: name, message: `access token valid until ${ch.tokenExpires}` });
  } else {
    out.push({ level: "info", area: name, message: `add tokenExpires: YYYY-MM-DD to be warned ${TOKEN_WARN_DAYS} days before the token stops working (LinkedIn tokens last 60 days)` });
  }
  return out;
}

function requiredEnv(ch: ChannelConfig): string[] {
  switch (ch.type) {
    case "linkedin":
      return [ch.tokenEnv];
    case "bluesky":
      return [ch.identifierEnv, ch.passwordEnv];
    case "mastodon":
      return [ch.tokenEnv];
    case "webhook":
    case "files":
      return [];
  }
}

/** One harmless authenticated request per network. Nothing is posted. */
async function onlineCheck(name: string, ch: ChannelConfig, deps: AdapterDeps): Promise<Check> {
  const env = deps.env;
  try {
    switch (ch.type) {
      case "linkedin": {
        const author = ch.organization ? `urn:li:organization:${ch.organization}` : `urn:li:person:${ch.person}`;
        const url = `${LINKEDIN_API}/posts?q=author&count=1&author=${encodeURIComponent(author)}`;
        const res = await fetchWithTimeout(deps, url, {
          headers: { Authorization: `Bearer ${env[ch.tokenEnv]}`, "LinkedIn-Version": ch.version, "X-Restli-Protocol-Version": "2.0.0" },
        }, `${name}: token check`);
        // 403 means the token is valid but lacks read access, which posting doesn't need.
        if (res.status === 401) return { level: "error", area: name, message: "LinkedIn rejected the access token (HTTP 401). It has expired or been revoked" };
        if (res.status === 426) return { level: "error", area: name, message: `LinkedIn no longer supports API version ${ch.version} (HTTP 426)` };
        if (!res.ok && res.status !== 403) return { level: "warn", area: name, message: `could not check the token: LinkedIn returned HTTP ${res.status}` };
        return { level: "ok", area: name, message: "LinkedIn accepted the access token" };
      }
      case "bluesky": {
        const res = await fetchWithTimeout(deps, `${ch.service.replace(/\/$/, "")}/xrpc/com.atproto.server.createSession`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: env[ch.identifierEnv], password: env[ch.passwordEnv] }),
        }, `${name}: login check`);
        if (res.status === 401) return { level: "error", area: name, message: "Bluesky rejected the identifier or app password (HTTP 401)" };
        if (!res.ok) return { level: "warn", area: name, message: `could not check the login: Bluesky returned HTTP ${res.status}` };
        const session = (await res.json()) as { handle?: string };
        return { level: "ok", area: name, message: `signed in to Bluesky as @${session.handle ?? "?"}` };
      }
      case "mastodon": {
        const res = await fetchWithTimeout(deps, `${ch.instance.replace(/\/$/, "")}/api/v1/accounts/verify_credentials`, {
          headers: { Authorization: `Bearer ${env[ch.tokenEnv]}` },
        }, `${name}: token check`);
        if (res.status === 401 || res.status === 403) return { level: "error", area: name, message: `Mastodon rejected the access token (HTTP ${res.status})` };
        if (!res.ok) return { level: "warn", area: name, message: `could not check the token: Mastodon returned HTTP ${res.status}` };
        const account = (await res.json()) as { acct?: string };
        return { level: "ok", area: name, message: `signed in to Mastodon as @${account.acct ?? "?"}` };
      }
      case "webhook":
        return { level: "info", area: name, message: "not called: a test request would trigger the receiver" };
      case "files":
        return { level: "ok", area: name, message: `writes to ${ch.dir}` };
    }
  } catch (error) {
    return { level: "warn", area: name, message: `could not reach the network: ${(error as Error).message}` };
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function runDoctor(opts: DoctorOptions): Promise<Check[]> {
  const { cfg, posts, now, env } = opts;
  const checks: Check[] = [{ level: "ok", area: "config", message: `loaded ${cfg.file}` }];

  // Posts and lint.
  const findings = lint(cfg, posts);
  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.length - errors.length;
  if (errors.length) {
    const ids = [...new Set(errors.map((f) => f.post.id))];
    checks.push({ level: "error", area: "posts", message: `${errors.length} lint error${errors.length === 1 ? "" : "s"} in ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? "…" : ""}; run postline lint` });
  } else {
    checks.push({ level: warns ? "warn" : "ok", area: "posts", message: `${posts.length} posts, no lint errors${warns ? `, ${warns} warning${warns === 1 ? "" : "s"}` : ""}` });
  }
  for (const post of posts) {
    if (post.status === "draft" && post.when && post.when.getTime() > now.getTime() && post.when.getTime() - now.getTime() < DRAFT_WARN_MS) {
      checks.push({ level: "warn", area: "posts", message: `${post.id} is still a draft but is scheduled for ${humanLabel(post.when, cfg.timezone)}` });
    }
  }
  const next = posts
    .filter((p) => p.status === "ready" && p.when && p.when.getTime() > now.getTime())
    .sort((a, b) => a.when!.getTime() - b.when!.getTime())[0];
  if (next?.when) checks.push({ level: "info", area: "posts", message: `next post: ${next.id} at ${humanLabel(next.when, cfg.timezone)}` });

  // Rendering.
  if (posts.some((p) => p.card) && opts.launchChromium) {
    const problem = await opts.launchChromium();
    checks.push(problem ? { level: "error", area: "chromium", message: problem } : { level: "ok", area: "chromium", message: "starts and can render cards" });
  }

  // Channels.
  const used = new Set(posts.flatMap((p) => p.channels));
  const deps: AdapterDeps | undefined = opts.fetch
    ? { env, fetch: opts.fetch, root: cfg.root, requestTimeoutMs: opts.requestTimeoutMs ?? 15_000 }
    : undefined;
  for (const [name, ch] of Object.entries(cfg.channels)) {
    if (!used.has(name)) {
      checks.push({ level: "info", area: name, message: "configured, but no post uses it" });
      continue;
    }
    const before = checks.length;
    const missing = requiredEnv(ch).filter((key) => !env[key]);
    if (missing.length) {
      checks.push({ level: "error", area: name, message: `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set` });
    }
    if (ch.type === "linkedin") checks.push(...linkedInChecks(name, ch, now));
    if (ch.type === "webhook" && !env[ch.secretEnv]) {
      checks.push({ level: "warn", area: name, message: `${ch.secretEnv} is not set, so requests are not signed` });
    }
    if (deps && missing.length === 0) checks.push(await onlineCheck(name, ch, deps));
    if (checks.length === before) checks.push({ level: "ok", area: name, message: `${ch.type} channel is set up` });
  }

  // A live publish run legitimately holds entries in "attempting".
  const lock = join(cfg.stateDir, "publish.lock");
  let lockHolder: { pid?: number; host?: string; since?: string } | undefined;
  let lockReadable = true;
  if (existsSync(lock)) {
    try {
      lockHolder = JSON.parse(readFileSync(lock, "utf8")) as { pid?: number; host?: string; since?: string };
    } catch {
      lockReadable = false;
    }
  }
  const publishRunning = Boolean(lockHolder && lockHolder.host === hostname() && typeof lockHolder.pid === "number" && processAlive(lockHolder.pid));

  // Ledger.
  try {
    const ledger = new Ledger(cfg.stateDir);
    let stuck = 0;
    for (const [key, entry] of ledger.all()) {
      const [post, channel] = key.split("::");
      if (entry.status === "attempting" && publishRunning) continue;
      if (entry.status === "attempting" || entry.status === "uncertain") {
        stuck++;
        checks.push({
          level: "error",
          area: "ledger",
          message: `${post} -> ${channel} may have gone out (${entry.status}); check ${channel}, then run postline mark or postline retry`,
        });
      } else if (entry.status === "failed" && entry.attempts >= cfg.publish.maxAttempts) {
        stuck++;
        checks.push({ level: "error", area: "ledger", message: `${post} -> ${channel} gave up after ${entry.attempts} attempts: ${entry.error ?? "unknown error"}` });
      }
    }
    if (!stuck) checks.push({ level: "ok", area: "ledger", message: `${ledger.all().length} entries, none stuck` });
  } catch (error) {
    checks.push({ level: "error", area: "ledger", message: (error as Error).message });
  }

  if (lockHolder) {
    checks.push(
      publishRunning
        ? { level: "info", area: "lock", message: `a publish run (pid ${lockHolder.pid}) is in progress since ${lockHolder.since}` }
        : { level: "warn", area: "lock", message: `${lock} was left by pid ${lockHolder.pid} on ${lockHolder.host}; delete it if nothing is running` },
    );
  } else if (!lockReadable) {
    checks.push({ level: "warn", area: "lock", message: `${lock} exists but is unreadable; delete it if nothing is running` });
  }

  // Scheduler.
  const workflow = resolve(cfg.root, ".github", "workflows", "postline.yml");
  if (existsSync(workflow)) {
    const pinned = /POSTLINE_VERSION:\s*"?([0-9][^"\s]*)"?/.exec(readFileSync(workflow, "utf8"))?.[1];
    if (pinned && pinned !== opts.version) {
      checks.push({ level: "warn", area: "workflow", message: `GitHub workflow installs postline ${pinned}, this is ${opts.version}; update POSTLINE_VERSION` });
    } else if (pinned) {
      checks.push({ level: "ok", area: "workflow", message: `GitHub workflow uses postline ${pinned}` });
    }
  }

  // Alerts.
  if (cfg.notify) {
    checks.push(
      notifyUrl(cfg.notify, env)
        ? { level: "ok", area: "notify", message: `sends ${cfg.notify.format} alerts for ${cfg.notify.on.join(", ")}` }
        : { level: "error", area: "notify", message: `${cfg.notify.urlEnv} is not set, so alerts can't be sent` },
    );
  } else {
    checks.push({ level: "info", area: "notify", message: "no alerts configured; add notify: to hear about failures" });
  }

  return checks;
}

/**
 * Doctor errors and warnings as alerts (warnings include the early token-expiry
 * notice), keyed so the same problem is sent once a day.
 */
export function doctorAlerts(checks: Check[]): Alert[] {
  return checks
    .filter((c) => c.level === "error" || c.level === "warn")
    .map((c) => ({ event: "doctor", message: `${c.level === "warn" ? "warning: " : ""}${c.area}: ${c.message}`, key: `doctor:${c.area}:${c.message}` }));
}
