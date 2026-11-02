#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, renameSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ConfigError, type Config } from "./config.js";
import { loadPosts, displayPath, type Post } from "./content.js";
import { lint } from "./lint.js";
import { planWeek, slotsForWeek, weekStart, nextWeekStart } from "./calendar.js";
import { Ledger } from "./ledger.js";
import { Renderer } from "./render/png.js";
import { publishDue } from "./publish.js";
import { brief } from "./brief.js";
import { localDate } from "./time.js";
import { runDaemon } from "./daemon.js";
import { Library } from "./library.js";
import { LockedError, withStateLock } from "./lock.js";
import { doctorAlerts, runDoctor, type Check } from "./doctor.js";
import { sendAlerts, type Alert } from "./notify.js";
import { startPreview } from "./preview.js";
import { buildReport, gitChanges, keepImage, RESTYLE_LIMIT, selectChanges, type ChangeSet, type RenderedImage } from "./pr-report.js";
import { BUILT_IN_LAYOUTS } from "./design.js";
import type { CardSize } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..", "..");

const VERSION_PLACEHOLDER = "__POSTLINE_VERSION__";

function packageVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  const version = typeof pkg === "object" && pkg !== null ? (pkg as Record<string, unknown>).version : undefined;
  if (typeof version !== "string") throw new Error("postline's package.json has no version");
  return version;
}

const HELP = `postline: plan, render and publish branded social posts from a git repo

Usage: postline <command> [options]

Commands
  init [dir]               scaffold a config, a sample post and a workflow
  plan [--week DATE]       create draft files for empty slots in a week
  status [--week DATE]     show a week's slots and what is filled or sent
  brief [--week DATE]      print a writing brief for a week (Markdown)
  lint                     check every post against the rules
  render [id] [--force]    render cards to out/cards (--html also writes HTML);
                           drafts are skipped unless named or --drafts
                           and keep a full-quality copy in the library (--no-library skips it)
  export <id> [--scale N] [--format png|jpeg] [--size S] [--out FILE]
                           save one card at any resolution, e.g. --scale 4 for print
  library [--open]         show where saved graphics live; --open opens the gallery
  layouts                  list built-in and custom card layouts
  pr-report --base REF [--all] [--images DIR] [--image-url URL] [--no-render]
            [--out FILE] [--json FILE] [--sha SHA] [--fail-on-error]
                           Markdown report of the posts a pull request changes:
                           rendered cards, lengths per channel and lint results
  preview [--port N] [--open]
                           local page per post: the card, lint results and each
                           channel's text as that network will show it
  publish [--dry-run]      send posts whose time has come
          [--now ISO] [--catch-up] [--only ID]
          [--prepare-only | --resume-prepared]
  daemon [--every MINUTES] keep publishing on a persistent machine (default: 15);
                           also runs doctor once a day and sends alerts
  doctor [--offline] [--notify]
                           check config, tokens, Chromium, the ledger and alerts;
                           --notify sends errors to your notify: destination
  retry <id> <channel>     clear a stuck, uncertain or failed entry so it sends again
  mark <id> <channel> <published|skipped> [--url URL]
                           record the outcome yourself (e.g. an uncertain post that did go out)

Global options
  --cwd DIR                project directory (default: current)
  --config FILE            config file (default: postline.config.yaml)
  -h, --help               show this help
  -v, --version            print version

DATE is YYYY-MM-DD; it snaps forward to the configured week start.
Without --week, plan/status/brief use the next posting week.`;

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h") out.flags.help = true;
    else if (a === "-v") out.flags.version = true;
    else if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) out.flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith("-")) out.flags[k] = argv[++i]!;
      else out.flags[k] = true;
    } else out._.push(a);
  }
  return out;
}

const BOOL_FLAGS = new Set([
  "force", "dry-run", "catch-up", "prepare-only", "resume-prepared", "html", "help", "version", "no-library", "open",
  "offline", "notify", "no-render", "fail-on-error", "all", "drafts",
]);

function libraryFor(cfg: Config, args: Args): Library | undefined {
  return cfg.library.enabled && !args.flags["no-library"] ? new Library(cfg) : undefined;
}

function openPath(path: string): void {
  const [cmd, cmdArgs] =
    process.platform === "darwin" ? ["open", [path]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", path]] : ["xdg-open", [path]];
  spawn(cmd as string, cmdArgs as string[], { detached: true, stdio: "ignore" }).on("error", () => {
    console.error(`could not open ${path}; open it in your browser instead`);
  }).unref();
}

function str(args: Args, k: string): string | undefined {
  const v = args.flags[k];
  return typeof v === "string" ? v : undefined;
}

function resolveWeek(cfg: Config, args: Args): string {
  const w = str(args, "week");
  try {
    return w ? weekStart(cfg, w) : nextWeekStart(cfg, new Date());
  } catch (error) {
    throw new ConfigError(`--week "${w}" is invalid: ${(error as Error).message}`);
  }
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint(31);
const yellow = paint(33);
const green = paint(32);
const dim = paint(2);

async function publishCommand(cwd: string, configFile: string | undefined, args: Args): Promise<number> {
  const cfg = loadConfig(cwd, configFile);
  const posts = loadPosts(cfg);
  const nowFlag = str(args, "now");
  const now = nowFlag ? new Date(nowFlag) : new Date();
  if (Number.isNaN(now.getTime())) throw new ConfigError(`--now "${nowFlag}" is not a date`);
  const prepareOnly = Boolean(args.flags["prepare-only"]);
  const resumePrepared = Boolean(args.flags["resume-prepared"]);
  if (prepareOnly && resumePrepared) throw new ConfigError("--prepare-only and --resume-prepared cannot be used together");
  const dryRun = Boolean(args.flags["dry-run"]);
  if (dryRun && (prepareOnly || resumePrepared)) {
    throw new ConfigError("--dry-run cannot be combined with --prepare-only or --resume-prepared");
  }
  // A dry run only reads the ledger, so it may run beside a daemon.
  return dryRun ? publishLocked(cfg, posts, args, now) : withStateLock(cfg.stateDir, () => publishLocked(cfg, posts, args, now));
}

async function publishLocked(cfg: Config, posts: Post[], args: Args, now: Date): Promise<number> {
  const prepareOnly = Boolean(args.flags["prepare-only"]);
  const resumePrepared = Boolean(args.flags["resume-prepared"]);
  // Read the ledger only once we hold the lock, so it reflects the last run.
  const ledger = new Ledger(cfg.stateDir);
  let renderer: Renderer | undefined;
  const only = str(args, "only");
  const library = libraryFor(cfg, args);
  try {
    const outcomes = await publishDue(cfg, posts, ledger, {
      now,
      dryRun: Boolean(args.flags["dry-run"]),
      catchUp: Boolean(args.flags["catch-up"]),
      prepareOnly,
      resumePrepared,
      ...(only === undefined ? {} : { only }),
      deps: { env: process.env, fetch: globalThis.fetch, root: cfg.root, requestTimeoutMs: cfg.publish.requestTimeoutMs },
      renderer: () => (renderer ??= new Renderer(cfg, { ...(library ? { library } : {}), warn: (m) => console.error(yellow(m)) })),
      ...(library ? { library } : {}),
      log: (line) => console.log(line),
    });
    if (outcomes.length === 0) console.log(`nothing due at ${now.toISOString()} (${localDate(now, cfg.timezone)} ${cfg.timezone})`);
    if (!args.flags["dry-run"] && !prepareOnly) {
      const alerts: Alert[] = [];
      for (const o of outcomes) {
        if (o.result !== "failed" && o.result !== "uncertain" && o.result !== "blocked") continue;
        // Keyed on the problem, not the attempt, so a failure that repeats every
        // run (a card that won't render) is reported once a day.
        alerts.push({ event: o.result, message: `${o.post} -> ${o.channel}: ${o.detail ?? o.result}`, key: `${o.result}:${o.post}:${o.channel}:${o.detail ?? ""}` });
      }
      await sendAlerts(cfg, alerts, notifyDeps(cfg, now));
    }
    return outcomes.some((outcome) => outcome.result === "failed" || outcome.result === "uncertain" || outcome.result === "blocked") ? 1 : 0;
  } finally {
    await renderer?.close();
  }
}

function notifyDeps(cfg: Config, now: Date) {
  return {
    env: process.env,
    fetch: globalThis.fetch,
    root: cfg.root,
    requestTimeoutMs: cfg.publish.requestTimeoutMs,
    now,
    log: (line: string) => console.error(yellow(line)),
  };
}

async function launchChromium(): Promise<string | undefined> {
  try {
    const { chromium } = await import("playwright-core");
    const executablePath = process.env.POSTLINE_CHROMIUM;
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    await browser.close();
    return undefined;
  } catch (error) {
    const first = (error as Error).message.split("\n")[0] ?? "unknown error";
    return `could not start Chromium (${first}). Run "npx playwright-core install chromium" or set POSTLINE_CHROMIUM`;
  }
}

const MARKS: Record<Check["level"], string> = { ok: "✓", info: "·", warn: "!", error: "✗" };

async function doctorCommand(cwd: string, configFile: string | undefined, args: Args, quiet = false): Promise<number> {
  let cfg: Config;
  try {
    cfg = loadConfig(cwd, configFile);
  } catch (error) {
    console.log(`${red(MARKS.error)} ${"config".padEnd(12)} ${(error as Error).message}`);
    return 1;
  }
  const now = new Date();
  const checks = await runDoctor({
    cfg,
    posts: loadPosts(cfg),
    now,
    env: process.env,
    version: packageVersion(),
    ...(args.flags.offline ? {} : { fetch: globalThis.fetch }),
    requestTimeoutMs: Math.min(cfg.publish.requestTimeoutMs, 15_000),
    launchChromium,
  });
  if (!quiet) {
    const paint = { ok: green, info: dim, warn: yellow, error: red };
    console.log(`postline ${packageVersion()} doctor: ${displayPath(cfg, cfg.file)}\n`);
    for (const c of checks) console.log(`${paint[c.level](MARKS[c.level])} ${c.area.padEnd(12)} ${c.level === "info" ? dim(c.message) : c.message}`);
  }
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  if (!quiet) console.log(`\n${errors} problem${errors === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}`);
  if (args.flags.notify) {
    const sent = await sendAlerts(cfg, doctorAlerts(checks), notifyDeps(cfg, now));
    if (sent && !quiet) console.log(`sent ${sent} alert${sent === 1 ? "" : "s"}`);
  }
  return errors > 0 ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  // Boolean flags shouldn't swallow the next positional argument.
  const args = parseArgs(argv);
  for (const k of Object.keys(args.flags)) {
    if (BOOL_FLAGS.has(k) && typeof args.flags[k] === "string") {
      args._.push(args.flags[k] as string);
      args.flags[k] = true;
    }
  }
  const [cmd, ...rest] = args._;
  if (args.flags.version) {
    console.log(packageVersion());
    return 0;
  }
  if (!cmd || args.flags.help || cmd === "help") {
    console.log(HELP);
    return 0;
  }

  const cwd = resolve(str(args, "cwd") ?? process.cwd());

  if (cmd === "init") {
    const target = resolve(cwd, rest[0] ?? ".");
    if (existsSync(join(target, "postline.config.yaml"))) {
      console.error(`${target} already has a postline.config.yaml`);
      return 1;
    }
    mkdirSync(target, { recursive: true });
    cpSync(join(pkgRoot, "templates", "init"), target, { recursive: true, force: false, errorOnExist: false });
    // npm drops .gitignore from published packages, so it ships without the dot.
    const gi = join(target, "gitignore");
    if (existsSync(gi)) {
      if (existsSync(join(target, ".gitignore"))) rmSync(gi);
      else renameSync(gi, join(target, ".gitignore"));
    }
    // Pin the workflow to the postline that scaffolded it.
    const workflow = join(target, ".github", "workflows", "postline.yml");
    if (existsSync(workflow)) {
      const source = readFileSync(workflow, "utf8");
      if (source.includes(VERSION_PLACEHOLDER)) writeFileSync(workflow, source.replaceAll(VERSION_PLACEHOLDER, packageVersion()));
    }
    console.log(`created a postline project in ${target}`);
    console.log("next: edit postline.config.yaml, then run `postline plan` and `postline render`");
    console.log("schedule without GitHub Actions: `postline daemon --every 15`");
    return 0;
  }

  if (cmd === "daemon") {
    const everyFlag = str(args, "every") ?? "15";
    const everyMinutes = Number(everyFlag);
    if (!Number.isSafeInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 1_440) {
      throw new ConfigError(`--every "${everyFlag}" must be a whole number from 1 to 1440 minutes`);
    }
    if (args.flags["prepare-only"] || args.flags["resume-prepared"] || args.flags["dry-run"] || str(args, "now")) {
      throw new ConfigError("daemon cannot be combined with --prepare-only, --resume-prepared, --dry-run or --now");
    }
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log(`postline daemon started; checking every ${everyMinutes} minute${everyMinutes === 1 ? "" : "s"}`);
    // Once a day the daemon also runs doctor, so an expiring token or a stuck
    // post raises an alert before the next post is due.
    let lastDoctor = 0;
    const task = async (): Promise<number> => {
      try {
        return await publishCommand(cwd, str(args, "config"), args);
      } finally {
        // Also when publishing throws: that's exactly when doctor's checks matter.
        if (Date.now() - lastDoctor >= 24 * 60 * 60 * 1000) {
          lastDoctor = Date.now();
          const health = await doctorCommand(cwd, str(args, "config"), { ...args, flags: { ...args.flags, notify: true } }, true);
          if (health !== 0) console.error(yellow("doctor found problems; run postline doctor for details"));
        }
      }
    };
    try {
      await runDaemon({
        intervalMs: Math.round(everyMinutes * 60_000),
        signal: controller.signal,
        task,
        log: (line) => console.log(line),
        error: (line) => console.error(red(line)),
      });
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
    console.log("postline daemon stopped");
    return 0;
  }

  if (cmd === "publish") return publishCommand(cwd, str(args, "config"), args);
  if (cmd === "doctor") return doctorCommand(cwd, str(args, "config"), args);

  if (cmd === "pr-report") {
    const cfg = loadConfig(cwd, str(args, "config"));
    const posts = loadPosts(cfg);
    const base = str(args, "base") ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined);
    let changes: ChangeSet;
    if (args.flags.all) changes = { posts };
    else if (base) changes = selectChanges(cfg, posts, gitChanges(cfg.root, base));
    else throw new ConfigError("pr-report needs --base REF (the branch the pull request targets) or --all");

    const images = new Map<string, RenderedImage>();
    const renderErrors = new Map<string, string>();
    const imagesDir = str(args, "images");
    if (imagesDir && !args.flags["no-render"]) {
      const urlTemplate = str(args, "image-url");
      const renderer = new Renderer(cfg);
      try {
        for (const post of changes.posts.slice(0, changes.restyled ? RESTYLE_LIMIT : undefined)) {
          if (!post.card) continue;
          try {
            const card = await renderer.render(post);
            images.set(post.id, keepImage(post, card.file, card.hash, resolve(cwd, imagesDir), urlTemplate));
          } catch (error) {
            renderErrors.set(post.id, (error as Error).message);
          }
        }
      } finally {
        await renderer.close();
      }
    }
    const sha = str(args, "sha") ?? process.env.GITHUB_SHA;
    const report = buildReport({ cfg, posts, changes, images, renderErrors, ...(sha ? { sha } : {}) });
    const out = str(args, "out");
    if (out) writeFileSync(resolve(cwd, out), report.markdown);
    else process.stdout.write(report.markdown);
    const json = str(args, "json");
    if (json) {
      const summary = {
        changed: report.changed,
        errors: report.errors,
        warnings: report.warnings,
        otherErrors: report.otherErrors,
        images: [...images.values()].map((i) => i.name),
      };
      writeFileSync(resolve(cwd, json), JSON.stringify(summary) + "\n");
    }
    return args.flags["fail-on-error"] && report.errors + report.otherErrors > 0 ? 1 : 0;
  }

  if (cmd === "preview") {
    const portFlag = str(args, "port") ?? "4400";
    const port = Number(portFlag);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new ConfigError(`--port "${portFlag}" is not a port number`);
    loadConfig(cwd, str(args, "config"));
    const configFile = str(args, "config");
    const server = await startPreview({ cwd, ...(configFile ? { configFile } : {}), port, log: (line) => console.error(yellow(line)) });
    console.log(`postline preview at ${server.url} (Ctrl+C to stop)`);
    if (args.flags.open) openPath(server.url);
    await new Promise<void>((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
    await server.close();
    return 0;
  }

  const cfg = loadConfig(cwd, str(args, "config"));
  const posts = loadPosts(cfg);

  switch (cmd) {
    case "plan": {
      const start = resolveWeek(cfg, args);
      const created = planWeek(cfg, start, posts);
      if (created.length === 0) console.log(`every slot in the week of ${start} already has a post`);
      for (const f of created) console.log(`created ${displayPath(cfg, f)}`);
      return 0;
    }

    case "status": {
      const start = resolveWeek(cfg, args);
      const ledger = new Ledger(cfg.stateDir);
      console.log(`week of ${start} (${cfg.timezone})\n`);
      for (const slot of slotsForWeek(cfg, start, posts)) {
        if (slot.posts.length === 0) {
          console.log(`${slot.label.padEnd(26)} ${dim("empty")}`);
          continue;
        }
        for (const p of slot.posts) {
          const sent = p.channels
            .map((ch) => {
              const e = ledger.get(p.id, ch);
              const s = e?.status ?? (p.status === "draft" ? "draft" : "queued");
              const paintIt = s === "published" ? green : s === "failed" || s === "attempting" || s === "uncertain" ? red : s === "draft" ? dim : (x: string) => x;
              return `${ch}:${paintIt(s)}`;
            })
            .join(" ");
          console.log(`${slot.label.padEnd(26)} ${p.id.padEnd(28)} ${sent}`);
        }
      }
      return 0;
    }

    case "brief": {
      process.stdout.write(brief(cfg, posts, resolveWeek(cfg, args)));
      return 0;
    }

    case "lint": {
      const findings = lint(cfg, posts);
      for (const f of findings) {
        const sev = f.severity === "error" ? red("error") : yellow("warn ");
        console.log(`${sev} ${displayPath(cfg, f.post.file)} ${dim(f.rule)} ${f.message}`);
      }
      const errors = findings.filter((f) => f.severity === "error").length;
      const warns = findings.length - errors;
      console.log(`\n${posts.length} posts, ${errors} errors, ${warns} warnings`);
      return errors > 0 ? 1 : 0;
    }

    case "render": {
      const id = rest[0];
      // A bulk render skips drafts (their cards are placeholders, and the library
      // keeps every version); name a draft or pass --drafts to render it anyway.
      const targets = posts.filter((p) => p.card && (id ? p.id === id : p.status !== "draft" || Boolean(args.flags.drafts)));
      if (id && targets.length === 0) {
        console.error(`no post "${id}" with a card`);
        return 1;
      }
      const library = libraryFor(cfg, args);
      const r = new Renderer(cfg, { ...(library ? { library } : {}), warn: (m) => console.error(yellow(m)) });
      let saved = 0;
      try {
        for (const p of targets) {
          if (args.flags.html) r.writeHtml(p);
          const out = await r.render(p, { force: Boolean(args.flags.force) });
          if (out.libraryFile) saved++;
          console.log(`${out.cached ? dim("cached  ") : green("rendered")} ${displayPath(cfg, out.file)}`);
        }
      } finally {
        await r.close();
      }
      if (library && saved > 0) console.log(`\nsaved ${saved} full-quality cop${saved === 1 ? "y" : "ies"} to ${library.dir}`);
      return 0;
    }

    case "export": {
      const id = rest[0];
      const post = posts.find((p) => p.id === id && p.card);
      if (!id || !post) {
        console.error(id ? `no post "${id}" with a card` : "usage: postline export <id> [--scale N] [--format png|jpeg] [--size S] [--out FILE]");
        return 1;
      }
      const scale = Number(str(args, "scale") ?? "4");
      if (!Number.isFinite(scale) || scale < 1 || scale > 8) throw new ConfigError("--scale must be between 1 and 8");
      const format = (str(args, "format") ?? "png") as "png" | "jpeg";
      if (format !== "png" && format !== "jpeg") throw new ConfigError("--format must be png or jpeg");
      const size = str(args, "size") as CardSize | undefined;
      if (size && !["square", "landscape", "portrait"].includes(size)) throw new ConfigError("--size must be square, landscape or portrait");
      const ext = format === "png" ? "png" : "jpg";
      const defaultDir = cfg.library.enabled ? join(cfg.library.dir, "exports") : join(cfg.outDir, "exports");
      const out = resolve(cwd, str(args, "out") ?? join(defaultDir, `${post.id}${size ? `-${size}` : ""}@${scale}x.${ext}`));
      const r = new Renderer(cfg);
      try {
        await r.export(post, { scale, format, quality: 95, out, ...(size ? { size } : {}) });
      } finally {
        await r.close();
      }
      console.log(`exported ${out}`);
      return 0;
    }

    case "library": {
      const library = new Library(cfg);
      const items = library.list();
      if (!cfg.library.enabled) console.log(yellow("the library is turned off (library.enabled: false, or running in CI)"));
      console.log(`folder:  ${library.dir}`);
      console.log(`cards:   ${items.length}`);
      if (items.length > 0) {
        if (!existsSync(library.indexFile)) library.writeIndex();
        console.log(`gallery: ${library.indexFile}`);
        for (const m of items.slice(0, 10)) {
          const sent = m.published.length ? green(`sent to ${m.published.map((p) => p.channel).join(", ")}`) : dim("not sent");
          console.log(`  ${m.file.padEnd(48)} ${sent}`);
        }
        if (items.length > 10) console.log(dim(`  ...and ${items.length - 10} more`));
        if (args.flags.open) openPath(library.indexFile);
      } else {
        console.log(dim("nothing saved yet; run `postline render`"));
      }
      return 0;
    }

    case "layouts": {
      const custom = cfg.design.layouts;
      for (const name of BUILT_IN_LAYOUTS) {
        console.log(`${name.padEnd(16)} ${custom[name] ? `custom (overrides built-in) ${displayPath(cfg, custom[name]!)}` : dim("built-in")}`);
      }
      for (const [name, file] of Object.entries(custom)) {
        if (!(BUILT_IN_LAYOUTS as readonly string[]).includes(name)) console.log(`${name.padEnd(16)} custom ${displayPath(cfg, file)}`);
      }
      if (cfg.design.tokensFile) console.log(`\ntokens: ${cfg.design.tokens.size} from ${displayPath(cfg, cfg.design.tokensFile)}`);
      if (cfg.design.stylesheet) console.log(`stylesheet: ${displayPath(cfg, cfg.design.stylesheet)}`);
      return 0;
    }

    case "retry": {
      const [id, channel] = rest;
      if (!id || !channel) {
        console.error("usage: postline retry <id> <channel>");
        return 1;
      }
      return withStateLock(cfg.stateDir, async () => {
        const ledger = new Ledger(cfg.stateDir);
        if (!ledger.reset(id, channel)) {
          console.error(`no ledger entry for ${id} on ${channel}`);
          return 1;
        }
        ledger.save();
        console.log(`cleared ${id} on ${channel}; it will go out on the next publish run`);
        return 0;
      });
    }

    case "mark": {
      const [id, channel, status] = rest;
      if (!id || !channel || (status !== "published" && status !== "skipped")) {
        console.error("usage: postline mark <id> <channel> <published|skipped> [--url URL]");
        return 1;
      }
      const url = str(args, "url");
      return withStateLock(cfg.stateDir, async () => {
        const ledger = new Ledger(cfg.stateDir);
        ledger.set(id, channel, {
          status,
          ...(url === undefined ? {} : { url }),
          ...(status === "skipped" ? { error: "marked by hand" } : {}),
        });
        ledger.save();
        console.log(`marked ${id} on ${channel} as ${status}`);
        return 0;
      });
    }

    default:
      console.error(`unknown command "${cmd}"\n`);
      console.log(HELP);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    const message = err instanceof ConfigError ? `config: ${err.message}` : err instanceof LockedError ? err.message : (err as Error).stack ?? String(err);
    console.error(red(message));
    process.exit(1);
  },
);
