import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToUtc, addDays, weekdayOf, nextWeekday, localDate, localTime } from "../src/time.js";

test("converts New York wall time to UTC across DST", () => {
  // EDT (UTC-4) before Nov 1 2026, EST (UTC-5) after.
  assert.equal(zonedToUtc("2026-10-27", "09:00", "America/New_York").toISOString(), "2026-10-27T13:00:00.000Z");
  assert.equal(zonedToUtc("2026-11-02", "09:00", "America/New_York").toISOString(), "2026-11-02T14:00:00.000Z");
});

test("handles zones east of UTC and half-hour offsets", () => {
  assert.equal(zonedToUtc("2026-06-01", "07:30", "Europe/London").toISOString(), "2026-06-01T06:30:00.000Z");
  assert.equal(zonedToUtc("2026-06-01", "09:00", "Asia/Kolkata").toISOString(), "2026-06-01T03:30:00.000Z");
  assert.equal(zonedToUtc("2026-06-01", "09:00", "Africa/Lagos").toISOString(), "2026-06-01T08:00:00.000Z");
});

test("round trips", () => {
  const d = zonedToUtc("2026-03-08", "15:00", "America/Los_Angeles");
  assert.equal(localDate(d, "America/Los_Angeles"), "2026-03-08");
  assert.equal(localTime(d, "America/Los_Angeles"), "15:00");
});

test("date arithmetic", () => {
  assert.equal(addDays("2026-10-31", 2), "2026-11-02");
  assert.equal(weekdayOf("2026-10-27"), "tue");
  assert.equal(nextWeekday("2026-10-22", "tue"), "2026-10-27");
  assert.equal(nextWeekday("2026-10-27", "tue"), "2026-10-27");
});

test("rejects bad input", () => {
  assert.throws(() => zonedToUtc("2026-1-1", "09:00", "UTC"));
  assert.throws(() => zonedToUtc("2026-01-01", "9am", "UTC"));
});
