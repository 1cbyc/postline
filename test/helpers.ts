import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeConfig, type Config } from "../src/config.js";
import { parsePost, type Post } from "../src/content.js";

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), "postline-"));
}

export function config(overrides: Record<string, unknown> = {}, root = tmp()): Config {
  return normalizeConfig(
    {
      brand: { name: "Test Co", url: "test.example" },
      timezone: "America/New_York",
      schedule: { weekStartsOn: "tue", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], times: ["09:00", "15:00", "21:00"] },
      channels: { linkedin: { type: "linkedin", organization: "1" }, bluesky: { type: "bluesky" } },
      ...overrides,
    },
    root,
  );
}

export function post(cfg: Config, front: string, body = "Hello world.", file = "/x/post.md"): Post {
  return parsePost(`---\n${front}\n---\n\n${body}\n`, file, cfg);
}
