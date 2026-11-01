import { createHash } from "node:crypto";
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

const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";

/**
 * A stable AT Protocol TID for one post on one channel: the scheduled time in
 * microseconds plus a 10-bit clock id taken from a hash of the delivery key.
 * Using it as the record key makes a retry find the first attempt's record
 * instead of creating a second post.
 */
export function recordKeyFor(postId: string, channel: string, when: Date): string {
  const clockId = BigInt(createHash("sha256").update(`${postId}::${channel}`).digest().readUInt16BE(0) & 0x3ff);
  let n = ((BigInt(when.getTime()) * 1000n) << 10n) | clockId;
  let out = "";
  for (let i = 0; i < 13; i++) {
    out = TID_ALPHABET[Number(n & 31n)]! + out;
    n >>= 5n;
  }
  return out;
}

const uriFor = (did: string, rkey: string) => `at://${did}/app.bsky.feed.post/${rkey}`;

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
    async publish({ post, channel, text, image }: PublishInput): Promise<PublishResult> {
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
      if (!post.when) throw new PublishError(`${name}: ${post.id} has no scheduled time`);
      const rkey = recordKeyFor(post.id, channel, post.when);
      const url = `https://bsky.app/profile/${session.handle}/post/${rkey}`;

      // An earlier attempt may have created the post without us hearing back.
      const lookup = new URL(`${service}/xrpc/com.atproto.repo.getRecord`);
      lookup.search = new URLSearchParams({ repo: session.did, collection: "app.bsky.feed.post", rkey }).toString();
      const existing = await fetchWithTimeout(deps, lookup.toString(), { headers: auth }, `${name}: check for earlier attempt`);
      if (existing.ok) {
        const found = (await existing.json()) as { uri?: string; value?: { text?: unknown } };
        if (found.value?.text !== text) {
          throw new PublishError(`${name}: record ${rkey} already exists with different text; check the account, then use postline mark`);
        }
        return { id: found.uri ?? uriFor(session.did, rkey), url };
      }
      if (existing.status !== 400 && existing.status !== 404) await expectOk(existing, `${name}: check for earlier attempt`);

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
            body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", rkey, record }),
            }, `${name}: create post`),
          `${name}: create post`,
        )
      ).json()) as { uri?: string };
      return { id: created.uri ?? uriFor(session.did, rkey), url };
    },
  };
}
