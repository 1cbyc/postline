import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError } from "../src/config.js";
import { alertRequest, sendAlerts, type Alert } from "../src/notify.js";
import { sign } from "../src/adapters/webhook.js";
import { config } from "./helpers.js";

const alerts: Alert[] = [
  { event: "uncertain", message: "p1 -> linkedin: timed out", key: "uncertain:p1:linkedin:1" },
  { event: "failed", message: "p2 -> bluesky: HTTP 400", key: "failed:p2:bluesky:1" },
];

function notifyConfig(extra: Record<string, unknown> = {}) {
  return config({ notify: { format: "slack", ...extra } });
}

test("notify config is validated", () => {
  assert.throws(() => config({ notify: { format: "teams" } }), ConfigError);
  assert.throws(() => config({ notify: { on: ["sometimes"] } }), ConfigError);
  assert.throws(() => config({ notify: { url: "https://a.example", urlEnv: "X" } }), ConfigError);
  const cfg = config({ notify: {} });
  assert.deepEqual(cfg.notify, { urlEnv: "POSTLINE_NOTIFY_URL", format: "json", secretEnv: "POSTLINE_NOTIFY_SECRET", on: ["failed", "uncertain", "blocked", "doctor"] });
  assert.equal(config().notify, undefined);
});

test("each format builds the request that service expects", () => {
  const base = { urlEnv: "U", secretEnv: "S", on: ["failed" as const] };
  const slack = JSON.parse(alertRequest({ ...base, format: "slack" }, alerts, "Acme", {}).body);
  assert.match(slack.text, /^\*postline \(Acme\): 2 posts need attention\*\n• uncertain: p1/);

  const discord = JSON.parse(alertRequest({ ...base, format: "discord" }, alerts, "Acme", {}).body);
  assert.match(discord.content, /^\*\*postline \(Acme\)/);

  const ntfy = alertRequest({ ...base, format: "ntfy" }, alerts, "Acmé", {});
  assert.equal(ntfy.headers.Title, "postline (Acm?): 2 posts need attention");
  assert.equal(ntfy.body, "uncertain: p1 -> linkedin: timed out\nfailed: p2 -> bluesky: HTTP 400");

  const json = alertRequest({ ...base, format: "json" }, alerts, "Acme", { S: "secret" });
  assert.equal(json.headers["X-Postline-Signature"], sign("secret", json.body));
  assert.equal(JSON.parse(json.body).alerts.length, 2);
});

test("alerts are sent once a day per problem, and only for subscribed events", async () => {
  const cfg = notifyConfig({ on: ["uncertain"] });
  const sent: string[] = [];
  const deps = (now: string) => ({
    env: { POSTLINE_NOTIFY_URL: "https://hooks.example/n" },
    fetch: (async (_url: string, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response("ok");
    }) as unknown as typeof fetch,
    root: cfg.root,
    now: new Date(now),
    log: () => {},
  });

  assert.equal(await sendAlerts(cfg, alerts, deps("2026-11-01T09:00:00Z")), 1);
  assert.match(sent[0]!, /p1 -> linkedin/);
  assert.doesNotMatch(sent[0]!, /p2/);
  assert.equal(await sendAlerts(cfg, alerts, deps("2026-11-01T20:00:00Z")), 0);
  assert.equal(await sendAlerts(cfg, alerts, deps("2026-11-02T09:30:00Z")), 1);
  assert.equal(sent.length, 2);
});

test("a failing alert destination never throws and is retried next time", async () => {
  const cfg = notifyConfig();
  const lines: string[] = [];
  let calls = 0;
  const deps = {
    env: { POSTLINE_NOTIFY_URL: "https://hooks.example/n" },
    fetch: (async () => {
      calls++;
      return calls === 1 ? new Response("down", { status: 503 }) : new Response("ok");
    }) as unknown as typeof fetch,
    root: cfg.root,
    now: new Date("2026-11-01T09:00:00Z"),
    log: (l: string) => lines.push(l),
  };
  assert.equal(await sendAlerts(cfg, alerts, deps), 0);
  assert.match(lines[0]!, /HTTP 503/);
  assert.equal(await sendAlerts(cfg, alerts, deps), 2);
});

test("a missing URL is reported instead of sending", async () => {
  const cfg = notifyConfig();
  const lines: string[] = [];
  const result = await sendAlerts(cfg, alerts, {
    env: {},
    fetch: (async () => assert.fail("should not send")) as unknown as typeof fetch,
    root: cfg.root,
    now: new Date(),
    log: (l) => lines.push(l),
  });
  assert.equal(result, 0);
  assert.match(lines[0]!, /POSTLINE_NOTIFY_URL is not set/);
});
