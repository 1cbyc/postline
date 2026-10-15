import { createHmac } from "node:crypto";
import type { Adapter, AdapterDeps, PublishInput, PublishResult } from "./types.js";
import { expectOk, fetchWithTimeout, PublishError } from "./types.js";
import type { WebhookChannelConfig } from "../config.js";

export function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Hands the post to anything that speaks HTTP: Zapier, Make, n8n, a Slack
 * approval bot, your own service. This is how you reach channels postline
 * doesn't ship an adapter for.
 */
export function webhook(name: string, cfg: WebhookChannelConfig, deps: AdapterDeps): Adapter {
  if (!cfg.url) throw new PublishError(`${name}: set "url"`);
  const url = cfg.url;
  const secretEnv = cfg.secretEnv;

  return {
    async publish({ post, channel, text, image }: PublishInput): Promise<PublishResult> {
      const delivery = `${post.id}::${channel}`;
      const body = JSON.stringify({
        delivery,
        id: post.id,
        channel,
        at: post.when?.toISOString(),
        topic: post.topic ?? null,
        text,
        image: image ? { mime: image.mime, alt: image.alt, base64: image.bytes.toString("base64") } : null,
      });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "postline",
        "X-Postline-Delivery": delivery,
      };
      const secret = deps.env[secretEnv];
      if (secret) headers["X-Postline-Signature"] = sign(secret, body);

        const res = await expectOk(await fetchWithTimeout(deps, url, { method: "POST", headers, body }, `${name}: webhook`), `${name}: webhook`);
      let reply: { id?: string; url?: string } = {};
      try {
        reply = (await res.json()) as typeof reply;
      } catch {}
        return { id: reply.id ?? delivery, ...(reply.url === undefined ? {} : { url: reply.url }) };
    },
  };
}
