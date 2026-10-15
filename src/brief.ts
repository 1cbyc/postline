import type { Config } from "./config.js";
import type { Post } from "./content.js";
import { slotsForWeek } from "./calendar.js";
import { channelLimit } from "./adapters/index.js";
import { addDays } from "./time.js";

const DAY_MS = 86_400_000;

/**
 * A plain-Markdown writing brief for one week: which slots are open, what the
 * house rules are, and which topics were used recently. Hand it to whoever
 * writes the copy.
 */
export function brief(cfg: Config, posts: Post[], start: string): string {
  const slots = slotsForWeek(cfg, start, posts);
  const open = slots.filter((s) => s.posts.length === 0 || s.posts.every((p) => p.status === "draft"));
  const since = (slots[0]?.at.getTime() ?? Date.now()) - Math.max(cfg.rules.topicCooldownDays, 28) * DAY_MS;
  const recent = posts
    .filter((p) => p.status === "ready" && p.when && p.when.getTime() >= since)
    .sort((a, b) => a.when!.getTime() - b.when!.getTime());

  const r = cfg.rules;
  const lines: string[] = [];
  lines.push(`# ${cfg.brand.name}: posts for ${start} to ${addDays(start, 6)}`, "");
  lines.push(`Timezone: ${cfg.timezone}. ${open.length} of ${slots.length} slots need copy.`, "");
  lines.push("## Open slots", "");
  for (const s of open) {
    const draft = s.posts[0];
    lines.push(`- ${s.label}${draft ? ` (draft: ${draft.id})` : ""}`);
  }
  lines.push("", "## Rules", "");
  lines.push(`- Channels: ${Object.entries(cfg.channels).map(([n, c]) => `${n} (max ${channelLimit(c).max} chars)`).join(", ")}`);
  lines.push(`- First line is the hook, ${r.hookMaxChars} characters or less.`);
  lines.push(`- At most ${r.maxHashtags} hashtags.`);
  if (!r.allowEmoji) lines.push("- No emoji.");
  if (r.allowedLinkDomains.length) lines.push(`- Links only to: ${r.allowedLinkDomains.join(", ")}`);
  if (r.bannedPhrases.length) lines.push(`- Never use: ${r.bannedPhrases.map((p) => `"${p}"`).join(", ")}`);
  if (r.requireImage) lines.push("- Every post needs a card (eyebrow, two-line headline, 2 to 4 items, footer).");
  lines.push("", "## Recent topics (avoid repeating)", "");
  if (recent.length === 0) lines.push("- none yet");
  for (const p of recent) {
    const hook = p.body.split("\n")[0]?.slice(0, 90) ?? "";
    lines.push(`- ${p.at}${p.topic ? ` [${p.topic}]` : ""}: ${hook}`);
  }
  lines.push("", "## File format", "", "One Markdown file per post in `" + cfg.postsDir.replace(cfg.root + "/", "") + "/`. See docs/guides/content-format.md.", "");
  return lines.join("\n");
}
