// Timezone helpers built on Intl so we don't pull in a date library.

const DAY_MS = 86_400_000;

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(date: Date, tz: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset of `tz` from UTC at instant `date`, in ms (positive east of UTC). */
export function tzOffset(date: Date, tz: string): number {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock date + time in `tz` -> UTC instant. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d) throw new Error(`invalid date "${date}" (expected YYYY-MM-DD)`);
  if (!t) throw new Error(`invalid time "${time}" (expected HH:MM, 24h)`);
  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  // Two passes handle DST transitions.
  let guess = naive - tzOffset(new Date(naive), tz);
  guess = naive - tzOffset(new Date(guess), tz);
  return new Date(guess);
}

/** Parse "YYYY-MM-DD HH:MM" (or with a T) in `tz`. */
export function parseLocal(value: string, tz: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`invalid datetime "${value}" (expected "YYYY-MM-DD HH:MM")`);
  return zonedToUtc(m[1]!, m[2]!, tz);
}

export function localDate(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p.year}-${pad(p.month!)}-${pad(p.day!)}`;
}

export function localTime(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${pad(p.hour!)}:${pad(p.minute!)}`;
}

export function weekdayOf(date: string): Weekday {
  const d = DATE_RE.exec(date);
  if (!d) throw new Error(`invalid date "${date}"`);
  const idx = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))).getUTCDay();
  return WEEKDAYS[idx]!;
}

export function addDays(date: string, n: number): string {
  const d = DATE_RE.exec(date);
  if (!d) throw new Error(`invalid date "${date}"`);
  const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) + n * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Human label like "Tue Oct 27, 9:00 AM". */
export function humanLabel(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Next date (inclusive) on or after `from` that falls on `weekday`. */
export function nextWeekday(from: string, weekday: Weekday): string {
  let cur = from;
  for (let i = 0; i < 7; i++) {
    if (weekdayOf(cur) === weekday) return cur;
    cur = addDays(cur, 1);
  }
  return cur;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
