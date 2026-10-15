import type { Adapter, AdapterDeps, PublishInput, PublishResult } from "./types.js";
import { expectOk, fetchWithTimeout, PublishError, requireEnv } from "./types.js";
import type { BlueskyChannelConfig } from "../config.js";
import { HASHTAG_RE, links } from "../text.js";

const MAX_BLOB = 1_000_000;

interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; uri?: string; tag?: string }>;
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** Rich-text facets for links and hashtags. Offsets are UTF-8 bytes. */
export function facetsFor(text: string): Facet[] {
  const out: Facet[] = [];
  for (const l of links(text)) {
    const byteStart = bytes(text.slice(0, l.index));
    out.push({
      index: { byteStart, byteEnd: byteStart + bytes(l.text) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: l.url }],
    });
  }
  for (const m of text.matchAll(HASHTAG_RE)) {
    const start = (m.index ?? 0) + m[1]!.length;
    const byteStart = bytes(text.slice(0, start));
    out.push({
      index: { byteStart, byteEnd: byteStart + bytes(`#${m[2]}`) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2]! }],
    });
  }
  return out.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

export function bluesky(name: string, cfg: BlueskyChannelConfig, deps: AdapterDeps): Adapter {
  const service = cfg.service.replace(/\/$/, "");
  const idEnv = cfg.identifierEnv;
  const pwEnv = cfg.passwordEnv;

  return {
    async publish({ text, image }: PublishInput): Promise<PublishResult> {
      const identifier = requireEnv(deps.env, idEnv, name);
      const password = requireEnv(deps.env, pwEnv, name);
      const json = { "Content-Type": "application/json" };

      const session = (await (
        await expectOk(
            await fetchWithTimeout(deps, `${service}/xrpc/com.atproto.server.createSession`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ identifier, password }),
            }, `${name}: login`),
          `${name}: login`,
        )
      ).json()) as { accessJwt: string; did: string; handle: string };
      const auth = { Authorization: `Bearer ${session.accessJwt}` };

      const record: Record<string, unknown> = {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
          langs: [cfg.lang],
      };
      const facets = facetsFor(text);
      if (facets.length) record.facets = facets;

      if (image) {
        if (image.bytes.length > MAX_BLOB) {
          throw new PublishError(
            `${name}: image is ${Math.round(image.bytes.length / 1024)} KB, Bluesky allows 1000 KB (set card.format: jpeg or lower card.scale)`,
          );
        }
        const up = (await (
          await expectOk(
              await fetchWithTimeout(deps, `${service}/xrpc/com.atproto.repo.uploadBlob`, {
              method: "POST",
              headers: { ...auth, "Content-Type": image.mime },
              body: new Uint8Array(image.bytes),
              }, `${name}: image upload`),
            `${name}: image upload`,
          )
        ).json()) as { blob: unknown };
        record.embed = {
          $type: "app.bsky.embed.images",
          images: [
            {
              alt: image.alt,
              image: up.blob,
              ...(image.width && image.height ? { aspectRatio: { width: image.width, height: image.height } } : {}),
            },
          ],
        };
      }

      const created = (await (
        await expectOk(
            await fetchWithTimeout(deps, `${service}/xrpc/com.atproto.repo.createRecord`, {
            method: "POST",
            headers: { ...auth, ...json },
            body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
            }, `${name}: create post`),
          `${name}: create post`,
        )
      ).json()) as { uri: string };
      const rkey = created.uri.split("/").pop();
      return { id: created.uri, url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
    },
  };
}
