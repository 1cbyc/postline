import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { Post } from "./content.js";
import { addDays, nextWeekday, weekdayOf, zonedToUtc, localDate, humanLabel } from "./time.js";

export interface Slot {
  date: string;
  time: string;
  at: Date;
  label: string;
  posts: Post[];
}

/** Start of the posting week that contains or follows `from`. */
export function weekStart(cfg: Config, from: string): string {
  return nextWeekday(from, cfg.schedule.weekStartsOn);
}

export function nextWeekStart(cfg: Config, now: Date): string {
  const today = localDate(now, cfg.timezone);
  return weekStart(cfg, addDays(today, 1));
}

export function slotsForWeek(cfg: Config, start: string, posts: Post[] = []): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    if (!cfg.schedule.days.includes(weekdayOf(date))) continue;
    for (const time of cfg.schedule.times) {
      const at = zonedToUtc(date, time, cfg.timezone);
      slots.push({
        date,
        time,
        at,
        label: humanLabel(at, cfg.timezone),
        posts: posts.filter((p) => p.when?.getTime() === at.getTime()),
      });
    }
  }
  return slots;
}

const STUB = (at: string, channels: string[]) => `---
at: ${at}
status: draft
channels: [${channels.join(", ")}]
topic:
card:
  layout: rows
  eyebrow:
  headline:
    - First line of the headline,
    - second line in the accent colour.
  items:
    - title:
      note:
  footer:
---

Hook line goes here.

`;

/** Writes a draft file for every empty slot. Returns the paths created. */
export function planWeek(cfg: Config, start: string, posts: Post[]): string[] {
  const dir = join(cfg.postsDir, start);
  const created: string[] = [];
  for (const slot of slotsForWeek(cfg, start, posts)) {
    if (slot.posts.length > 0) continue;
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${slot.date}-${slot.time.replace(":", "")}.md`);
    if (existsSync(file)) continue;
    writeFileSync(file, STUB(`${slot.date} ${slot.time}`, Object.keys(cfg.channels)));
    created.push(file);
  }
  return created;
}
