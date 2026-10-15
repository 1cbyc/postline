import { test } from "node:test";
import assert from "node:assert/strict";
import { runDaemon } from "../src/daemon.js";

test("daemon runs immediately, serially and stops after abort", async () => {
  const controller = new AbortController();
  let runs = 0;
  let active = 0;
  let maximumActive = 0;

  await runDaemon({
    intervalMs: 1,
    signal: controller.signal,
    task: async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      if (runs === 3) controller.abort();
      return 0;
    },
    log: () => undefined,
    error: () => undefined,
  });

  assert.equal(runs, 3);
  assert.equal(maximumActive, 1);
});

test("daemon reports a failed cycle and keeps running", async () => {
  const controller = new AbortController();
  const errors: string[] = [];
  let runs = 0;

  await runDaemon({
    intervalMs: 1,
    signal: controller.signal,
    task: async () => {
      runs++;
      if (runs === 1) throw new Error("temporary failure");
      controller.abort();
      return 0;
    },
    log: () => undefined,
    error: (message) => errors.push(message),
  });

  assert.equal(runs, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /temporary failure/);
});
