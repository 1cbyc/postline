// Timezone helpers built on Intl so we don't pull in a date library.

const DAY_MS = 86_400_000;

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function dateParts(value: string): [number, number, number] {
  const match = DATE_RE.exec(value);
  if (!match) throw new Error(`invalid date "${value}" (expected YYYY-MM-DD)`);
  const result: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const normalized = new Date(Date.UTC(result[0], result[1] - 1, result[2])).toISOString().slice(0, 10);
  if (normalized !== value) throw new Error(`invalid date "${value}"`);
  return result;
}

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
  const [year, month, day] = dateParts(date);
  const t = TIME_RE.exec(time);
  if (!t) throw new Error(`invalid time "${time}" (expected HH:MM, 24h)`);
  const naive = Date.UTC(year, month - 1, day, Number(t[1]), Number(t[2]));
  // Two passes handle DST transitions.
  let guess = naive - tzOffset(new Date(naive), tz);
  guess = naive - tzOffset(new Date(guess), tz);
  const result = new Date(guess);
  const actual = parts(result, tz);
  const expected = {
    year,
    month,
    day,
    hour: Number(t[1]),
    minute: Number(t[2]),
  };
  if (
    actual.year !== expected.year ||
    actual.month !== expected.month ||
    actual.day !== expected.day ||
    actual.hour !== expected.hour ||
    actual.minute !== expected.minute
  ) {
    throw new Error(`invalid or nonexistent local datetime "${date} ${time}" in ${tz}`);
  }
  return result;
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
  const [year, month, day] = dateParts(date);
  const idx = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAYS[idx]!;
}

export function addDays(date: string, n: number): string {
  const [year, month, day] = dateParts(date);
  const ms = Date.UTC(year, month - 1, day) + n * DAY_MS;
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
