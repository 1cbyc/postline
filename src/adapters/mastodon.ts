import type { Adapter, AdapterDeps, PublishInput, PublishResult } from "./types.js";
import { deliver, DeliveryUncertainError, expectOk, fetchWithTimeout, PublishError, requireEnv } from "./types.js";
import type { MastodonChannelConfig } from "../config.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mastodon keeps an Idempotency-Key for about an hour. A retry inside that
 * window can't create a second status; outside it, it can. Leave a margin.
 */
export const MASTODON_RETRY_WINDOW_MS = 50 * 60 * 1000;

export function mastodon(name: string, cfg: MastodonChannelConfig, deps: AdapterDeps): Adapter {
  if (!cfg.instance) throw new PublishError(`${name}: set "instance" (e.g. https://mastodon.social)`);
  const base = cfg.instance.replace(/\/$/, "");
  const tokenEnv = cfg.tokenEnv;
  const pollMs = cfg.pollMs;

  return {
    async publish({ post, channel, text, image, attemptStartedAt, retryBefore, now = () => new Date() }: PublishInput): Promise<PublishResult> {
      const auth = { Authorization: `Bearer ${requireEnv(deps.env, tokenEnv, name)}` };
      const mediaIds: string[] = [];

      if (image) {
        const form = new FormData();
        const ext = image.mime === "image/png" ? "png" : "jpg";
        form.append("file", new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `${post.id}.${ext}`);
        form.append("description", image.alt);
        const res = await expectOk(
          await fetchWithTimeout(deps, `${base}/api/v2/media`, { method: "POST", headers: auth, body: form }, `${name}: media upload`),
          `${name}: media upload`,
        );
        let media = (await res.json()) as { id: string; url: string | null };
        // 202 means the server is still processing; posting before it's done fails.
        for (let i = 0; !media.url && i < 15; i++) {
          await sleep(pollMs);
          const r = await fetchWithTimeout(deps, `${base}/api/v1/media/${media.id}`, { headers: auth }, `${name}: media processing`);
          if (r.status === 200) media = (await r.json()) as typeof media;
        }
        if (!media.url) throw new PublishError(`${name}: media ${media.id} still processing, giving up`);
        mediaIds.push(media.id);
      }

      // Media uploads can take a while; check an earlier deadline just before sending.
      if (retryBefore && now().getTime() >= retryBefore.getTime()) {
        throw new DeliveryUncertainError(`${name}: an earlier attempt had no clear result and Mastodon no longer remembers its idempotency key`);
      }
      const sentAt = now();
      try {
        return await deliver(`${name}: create status`, async () => {
          const res = await expectOk(
            await fetchWithTimeout(deps, `${base}/api/v1/statuses`, {
              method: "POST",
              headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": `${post.id}::${channel}` },
              body: JSON.stringify({
                status: text,
                media_ids: mediaIds,
                visibility: cfg.visibility,
                language: cfg.lang,
              }),
            }, `${name}: create status`),
            `${name}: create status`,
          );
          const status = (await res.json()) as { id: string; url?: string };
          return { id: status.id, ...(status.url === undefined ? {} : { url: status.url }) };
        });
      } catch (error) {
        // An unclear result is safe to retry while Mastodon still remembers the
        // key, which it stores when it handles this request. publishDue compares
        // the deadline with its own clock.
        if (!(error instanceof DeliveryUncertainError)) throw error;
        const deadline = new Date((attemptStartedAt ?? sentAt).getTime() + MASTODON_RETRY_WINDOW_MS);
        throw new PublishError(error.message.replace(/ \(it may have gone out\)$/, ""), error.status, error.body, deadline);
      }
    },
  };
}
