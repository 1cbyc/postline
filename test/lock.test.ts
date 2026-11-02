import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { LockedError, withStateLock } from "../src/lock.js";
import { tmp } from "./helpers.js";

test("a second process cannot take the state lock while the first holds it", async () => {
  const dir = join(tmp(), ".postline");
  await withStateLock(dir, async () => {
    assert.ok(existsSync(join(dir, "publish.lock")));
    await assert.rejects(withStateLock(dir, async () => "inner"), LockedError);
  });
  assert.ok(!existsSync(join(dir, "publish.lock")));
});

test("the lock is released when the work throws", async () => {
  const dir = join(tmp(), ".postline");
  await assert.rejects(withStateLock(dir, async () => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(await withStateLock(dir, async () => "again"), "again");
});

test("a lock left by a dead process on this machine is taken over", async () => {
  const dir = join(tmp(), ".postline");
  mkdirSync(dir, { recursive: true });
  // PIDs are capped well below this on every supported platform.
  writeFileSync(join(dir, "publish.lock"), JSON.stringify({ pid: 2 ** 30, host: hostname(), since: "2026-01-01T00:00:00Z" }));
  assert.equal(await withStateLock(dir, async () => "ok"), "ok");
});

test("a lock held from another machine is respected", async () => {
  const dir = join(tmp(), ".postline");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "publish.lock"), JSON.stringify({ pid: 1, host: `not-${hostname()}`, since: "2026-01-01T00:00:00Z" }));
  await assert.rejects(withStateLock(dir, async () => "ok"), /delete/);
});

test("a lock that is released while we wait is taken instead of reported", async () => {
  const dir = join(tmp(), ".postline");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "publish.lock");
  writeFileSync(file, "");
  setTimeout(() => rmSync(file, { force: true }), 120);
  assert.equal(await withStateLock(dir, async () => "mine"), "mine");
});
