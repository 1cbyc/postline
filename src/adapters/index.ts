import type { ChannelConfig } from "../config.js";
import type { Adapter, AdapterDeps } from "./types.js";
import { linkedin } from "./linkedin.js";
import { bluesky } from "./bluesky.js";
import { mastodon } from "./mastodon.js";
import { webhook } from "./webhook.js";
import { files } from "./files.js";

export * from "./types.js";

export function createAdapter(name: string, cfg: ChannelConfig, deps: AdapterDeps): Adapter {
  switch (cfg.type) {
    case "linkedin":
      return linkedin(name, cfg, deps);
    case "bluesky":
      return bluesky(name, cfg, deps);
    case "mastodon":
      return mastodon(name, cfg, deps);
    case "webhook":
      return webhook(name, cfg, deps);
    case "files":
      return files(name, cfg, deps);
  }
}

export interface Limit {
  max: number;
  graphemes: boolean;
}

export function channelLimit(cfg: ChannelConfig): Limit {
  const override = cfg.maxChars;
  switch (cfg.type) {
    case "linkedin":
      return { max: override ?? 3000, graphemes: false };
    case "bluesky":
      return { max: override ?? 300, graphemes: true };
    case "mastodon":
      return { max: override ?? 500, graphemes: false };
    default:
      return { max: override ?? 100_000, graphemes: false };
  }
}
