import type { Adapter, AdapterDeps, PublishInput, PublishResult } from "./types.js";
import { expectOk, PublishError, requireEnv } from "./types.js";
import type { ChannelConfig } from "../config.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mastodon(name: string, cfg: ChannelConfig, deps: AdapterDeps): Adapter {
  if (!cfg.instance) throw new PublishError(`${name}: set "instance" (e.g. https://mastodon.social)`);
  const base = String(cfg.instance).replace(/\/$/, "");
  const tokenEnv = String(cfg.tokenEnv ?? "MASTODON_ACCESS_TOKEN");
  const pollMs = Number(cfg.pollMs ?? 1000);

  return {
    async publish({ post, channel, text, image }: PublishInput): Promise<PublishResult> {
      const auth = { Authorization: `Bearer ${requireEnv(deps.env, tokenEnv, name)}` };
      const mediaIds: string[] = [];

      if (image) {
        const form = new FormData();
        const ext = image.mime === "image/png" ? "png" : "jpg";
        form.append("file", new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `${post.id}.${ext}`);
        form.append("description", image.alt);
        const res = await expectOk(
          await deps.fetch(`${base}/api/v2/media`, { method: "POST", headers: auth, body: form }),
          `${name}: media upload`,
        );
        let media = (await res.json()) as { id: string; url: string | null };
        // 202 means the server is still processing; posting before it's done fails.
        for (let i = 0; !media.url && i < 15; i++) {
          await sleep(pollMs);
          const r = await deps.fetch(`${base}/api/v1/media/${media.id}`, { headers: auth });
          if (r.status === 200) media = (await r.json()) as typeof media;
        }
        if (!media.url) throw new PublishError(`${name}: media ${media.id} still processing, giving up`);
        mediaIds.push(media.id);
      }

      const res = await expectOk(
        await deps.fetch(`${base}/api/v1/statuses`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": `${post.id}::${channel}` },
          body: JSON.stringify({
            status: text,
            media_ids: mediaIds,
            visibility: cfg.visibility ?? "public",
            language: cfg.lang ?? "en",
          }),
        }),
        `${name}: create status`,
      );
      const status = (await res.json()) as { id: string; url?: string };
      return { id: status.id, url: status.url };
    },
  };
}
