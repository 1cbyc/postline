import type { Config } from "./config.js";
import { type Post, textFor } from "./content.js";
import { channelLimit } from "./adapters/index.js";
import { graphemeLength, hashtags, links, hostAllowed, hasEmoji, findMojibake, firstLine } from "./text.js";

export interface Finding {
  post: Post;
  rule: string;
  severity: "error" | "warn";
  message: string;
}

const DAY_MS = 86_400_000;

export function lint(cfg: Config, posts: Post[]): Finding[] {
  const out: Finding[] = [];
  const add = (post: Post, rule: string, severity: Finding["severity"], message: string) =>
    out.push({ post, rule, severity, message });

  const ids = new Map<string, Post>();
  const slots = new Map<string, Post>();

  for (const post of posts) {
    for (const p of post.problems) add(post, "parse", "error", p);

    const dupe = ids.get(post.id);
    if (dupe) add(post, "duplicate-id", "error", `id "${post.id}" is also used by ${dupe.file}`);
    ids.set(post.id, post);

    if (post.status === "draft") continue;

    if (!post.at) add(post, "missing-at", "error", `"at" is required for ready posts`);
    if (post.channels.length === 0) add(post, "no-channels", "error", "post has no channels");
    if (!post.body) add(post, "empty-body", "error", "post body is empty");

    for (const ch of post.channels) {
      const chCfg = cfg.channels[ch];
      if (!chCfg) {
        add(post, "unknown-channel", "error", `channel "${ch}" is not in the config`);
        continue;
      }
      if (post.when) {
        const key = `${ch}@${post.when.toISOString()}`;
        const other = slots.get(key);
        if (other) add(post, "slot-collision", "error", `${ch} already has "${other.id}" at ${post.at}`);
        slots.set(key, post);
      }
      const text = textFor(post, ch);
      const limit = channelLimit(chCfg);
      const len = limit.graphemes ? graphemeLength(text) : text.length;
      if (len > limit.max) {
        add(post, "too-long", "error", `${ch}: ${len} chars, limit is ${limit.max}${post.variants[ch] ? "" : ` (add variants.${ch})`}`);
      }
    }

    const all = [post.body, ...Object.values(post.variants)].join("\n");

    const bad = findMojibake(all) ?? (post.card ? findMojibake(JSON.stringify(post.card)) : undefined);
    if (bad) add(post, "encoding", "error", `looks like broken encoding near "${bad}" (save the file as UTF-8)`);

    const tags = hashtags(post.body);
    if (tags.length > cfg.rules.maxHashtags) {
      add(post, "hashtags", "error", `${tags.length} hashtags, max is ${cfg.rules.maxHashtags}`);
    }

    if (!cfg.rules.allowEmoji && hasEmoji(all)) add(post, "emoji", "error", "emoji are turned off for this brand");

    if (cfg.rules.allowedLinkDomains.length > 0) {
      for (const l of links(all)) {
        if (!hostAllowed(l.host, cfg.rules.allowedLinkDomains)) {
          add(post, "link-domain", "error", `link to ${l.host} is not in allowedLinkDomains`);
        }
      }
    }

    const hook = firstLine(post.body);
    if (hook.length > cfg.rules.hookMaxChars) {
      add(post, "hook-length", "warn", `first line is ${hook.length} chars, aim for ${cfg.rules.hookMaxChars} or less`);
    }

    const lower = all.toLowerCase();
    for (const phrase of cfg.rules.bannedPhrases) {
      if (lower.includes(phrase.toLowerCase())) add(post, "banned-phrase", "error", `contains "${phrase}"`);
    }

    if (cfg.rules.requireImage && !post.card && !post.image) {
      add(post, "no-image", "error", "every post needs a card or an image");
    }
    if (post.card) {
      post.card.headline.forEach((line, i) => {
        if (line.length > 60) add(post, "card-headline", "warn", `headline line ${i + 1} is ${line.length} chars and may wrap badly`);
      });
      if (post.card.items.length > 4) add(post, "card-items", "warn", `${post.card.items.length} card items, more than 4 gets cramped`);
    }
  }

  // Topic cooldown: same topic too close together reads as repetition.
  if (cfg.rules.topicCooldownDays > 0) {
    const withTopic = posts
      .filter((p) => p.status === "ready" && p.topic && p.when)
      .sort((a, b) => a.when!.getTime() - b.when!.getTime());
    const last = new Map<string, Post>();
    for (const p of withTopic) {
      const key = p.topic!.toLowerCase();
      const prev = last.get(key);
      if (prev && p.when!.getTime() - prev.when!.getTime() < cfg.rules.topicCooldownDays * DAY_MS) {
        add(p, "topic-repeat", "warn", `topic "${p.topic}" was used by "${prev.id}" less than ${cfg.rules.topicCooldownDays} days earlier`);
      }
      last.set(key, p);
    }
  }

  return out;
}
