import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const forbiddenEmail = ["isaacnsisong", "gmail.com"].join("@");
const escapedEmail = forbiddenEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const forbiddenPattern = new RegExp(`(^|[^A-Za-z0-9._%+\\-])${escapedEmail}([^A-Za-z0-9._%+\\-]|$)`, "m");

test("tracked files and commit identities do not expose the personal email", () => {
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const containingFiles = paths.filter((path) => forbiddenPattern.test(readFileSync(resolve(root, path), "utf8")));
  assert.deepEqual(containingFiles, []);

  const identities = execFileSync("git", ["log", "--format=%ae%n%ce"], { cwd: root })
    .toString("utf8")
    .split("\n")
    .filter(Boolean);
  assert.ok(!identities.includes(forbiddenEmail));
});
