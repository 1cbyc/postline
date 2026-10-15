import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { slotsForWeek, planWeek, nextWeekStart, weekStart } from "../src/calendar.js";
import { parsePost } from "../src/content.js";
import { config, post } from "./helpers.js";

test("a Tue-start week with 3 daily times has 21 slots", () => {
  const cfg = config();
  const slots = slotsForWeek(cfg, "2026-10-27");
  assert.equal(slots.length, 21);
  assert.equal(slots[0]!.label, "Tue, Oct 27, 9:00 AM");
  assert.equal(slots.at(-1)!.date, "2026-11-02");
});

test("next week start from a Thursday run", () => {
  const cfg = config();
  assert.equal(nextWeekStart(cfg, new Date("2026-10-22T13:48:00Z")), "2026-10-27");
  assert.equal(weekStart(cfg, "2026-10-27"), "2026-10-27");
});

test("plan fills only empty slots and the stubs parse", () => {
  const cfg = config();
  const existing = post(cfg, "at: 2026-10-27 09:00");
  const created = planWeek(cfg, "2026-10-27", [existing]);
  assert.equal(created.length, 20);
  const dir = join(cfg.postsDir, "2026-10-27");
  assert.equal(readdirSync(dir).length, 20);
  const stub = parsePost(readFileSync(created[0]!, "utf8"), created[0]!, cfg);
  assert.equal(stub.status, "draft");
  assert.equal(stub.at, "2026-10-27 15:00");
  // running again creates nothing new
  assert.equal(planWeek(cfg, "2026-10-27", [existing]).length, 0);
});
