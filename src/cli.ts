#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, cpSync, renameSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ConfigError, type Config } from "./config.js";
import { loadPosts, displayPath } from "./content.js";
import { lint } from "./lint.js";
import { planWeek, slotsForWeek, weekStart, nextWeekStart } from "./calendar.js";
import { Ledger } from "./ledger.js";
import { Renderer } from "./render/png.js";
import { publishDue } from "./publish.js";
import { brief } from "./brief.js";
import { localDate } from "./time.js";
import { runDaemon } from "./daemon.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..", "..");

const HELP = `postline: plan, render and publish branded social posts from a git repo

Usage: postline <command> [options]

Commands
  init [dir]               scaffold a config, a sample post and a workflow
  plan [--week DATE]       create draft files for empty slots in a week
  status [--week DATE]     show a week's slots and what is filled or sent
  brief [--week DATE]      print a writing brief for a week (Markdown)
  lint                     check every post against the rules
  render [id] [--force]    render cards to out/cards (--html also writes HTML)
  publish [--dry-run]      send posts whose time has come
          [--now ISO] [--catch-up] [--only ID]
          [--prepare-only | --resume-prepared]
  daemon [--every MINUTES] keep publishing on a persistent machine (default: 15)
  retry <id> <channel>     clear a stuck or failed entry so it sends again
  mark <id> <channel> <published|skipped> [--url URL]
                           record the outcome yourself (e.g. a stuck post that did go out)

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

const BOOL_FLAGS = new Set(["force", "dry-run", "catch-up", "prepare-only", "resume-prepared", "html", "help", "version"]);

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
  if (Boolean(args.flags["dry-run"]) && (prepareOnly || resumePrepared)) {
    throw new ConfigError("--dry-run cannot be combined with --prepare-only or --resume-prepared");
  }
  const ledger = new Ledger(cfg.stateDir);
  let renderer: Renderer | undefined;
  const only = str(args, "only");
  try {
    const outcomes = await publishDue(cfg, posts, ledger, {
      now,
      dryRun: Boolean(args.flags["dry-run"]),
      catchUp: Boolean(args.flags["catch-up"]),
      prepareOnly,
      resumePrepared,
      ...(only === undefined ? {} : { only }),
      deps: { env: process.env, fetch: globalThis.fetch, root: cfg.root, requestTimeoutMs: cfg.publish.requestTimeoutMs },
      renderer: () => (renderer ??= new Renderer(cfg)),
      log: (line) => console.log(line),
    });
    if (outcomes.length === 0) console.log(`nothing due at ${now.toISOString()} (${localDate(now, cfg.timezone)} ${cfg.timezone})`);
    return outcomes.some((outcome) => outcome.result === "failed" || outcome.result === "blocked") ? 1 : 0;
  } finally {
    await renderer?.close();
  }
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
    console.log(JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version);
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
    try {
      await runDaemon({
        intervalMs: Math.round(everyMinutes * 60_000),
        signal: controller.signal,
        task: () => publishCommand(cwd, str(args, "config"), args),
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
              const paintIt = s === "published" ? green : s === "failed" || s === "attempting" ? red : s === "draft" ? dim : (x: string) => x;
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
      const targets = posts.filter((p) => p.card && (!id || p.id === id));
      if (id && targets.length === 0) {
        console.error(`no post "${id}" with a card`);
        return 1;
      }
      const r = new Renderer(cfg);
      try {
        for (const p of targets) {
          if (args.flags.html) r.writeHtml(p);
          const out = await r.render(p, { force: Boolean(args.flags.force) });
          console.log(`${out.cached ? dim("cached  ") : green("rendered")} ${displayPath(cfg, out.file)}`);
        }
      } finally {
        await r.close();
      }
      return 0;
    }

    case "retry": {
      const [id, channel] = rest;
      if (!id || !channel) {
        console.error("usage: postline retry <id> <channel>");
        return 1;
      }
      const ledger = new Ledger(cfg.stateDir);
      if (!ledger.reset(id, channel)) {
        console.error(`no ledger entry for ${id} on ${channel}`);
        return 1;
      }
      ledger.save();
      console.log(`cleared ${id} on ${channel}; it will go out on the next publish run`);
      return 0;
    }

    case "mark": {
      const [id, channel, status] = rest;
      if (!id || !channel || (status !== "published" && status !== "skipped")) {
        console.error("usage: postline mark <id> <channel> <published|skipped> [--url URL]");
        return 1;
      }
      const ledger = new Ledger(cfg.stateDir);
      const url = str(args, "url");
      ledger.set(id, channel, {
        status,
        ...(url === undefined ? {} : { url }),
        ...(status === "skipped" ? { error: "marked by hand" } : {}),
      });
      ledger.save();
      console.log(`marked ${id} on ${channel} as ${status}`);
      return 0;
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
    console.error(red(err instanceof ConfigError ? `config: ${err.message}` : (err as Error).stack ?? String(err)));
    process.exit(1);
  },
);
