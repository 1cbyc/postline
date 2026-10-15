import type { Adapter, AdapterDeps, PublishInput, PublishResult } from "./types.js";
import { expectOk, PublishError, requireEnv } from "./types.js";
import type { ChannelConfig } from "../config.js";
import { HASHTAG_RE } from "../text.js";

const API = "https://api.linkedin.com/rest";
// LinkedIn versions its REST API monthly and retires versions after about a
// year. Override with `version:` in the channel config when this goes stale.
export const DEFAULT_LINKEDIN_VERSION = "202509";

const RESERVED = /[\\|{}@[\]()<>#*_~]/g;

/** LinkedIn "little text" escaping, keeping hashtags clickable. */
export function toLittleText(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(HASHTAG_RE)) {
    const start = (m.index ?? 0) + m[1]!.length;
    out += text.slice(last, start).replace(RESERVED, (c) => `\\${c}`);
    out += `{hashtag|\\#|${m[2]}}`;
    last = start + 1 + m[2]!.length;
  }
  out += text.slice(last).replace(RESERVED, (c) => `\\${c}`);
  return out;
}

export function linkedin(name: string, cfg: ChannelConfig, deps: AdapterDeps): Adapter {
  const org = cfg.organization as string | undefined;
  const person = cfg.person as string | undefined;
  if (!org && !person) throw new PublishError(`${name}: set "organization" (page ID) or "person"`);
  const author = org ? `urn:li:organization:${org}` : `urn:li:person:${person}`;
  const version = String(cfg.version ?? DEFAULT_LINKEDIN_VERSION);
  const tokenEnv = String(cfg.tokenEnv ?? "LINKEDIN_ACCESS_TOKEN");

  return {
    async publish({ text, image }: PublishInput): Promise<PublishResult> {
      const token = requireEnv(deps.env, tokenEnv, name);
      const headers = {
        Authorization: `Bearer ${token}`,
        "LinkedIn-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      };

      let media: { id: string; altText?: string } | undefined;
      if (image) {
        const init = await expectOk(
          await deps.fetch(`${API}/images?action=initializeUpload`, {
            method: "POST",
            headers,
            body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
          }),
          `${name}: image upload init`,
        );
        const { value } = (await init.json()) as { value: { uploadUrl: string; image: string } };
        await expectOk(
          await deps.fetch(value.uploadUrl, {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": image.mime },
            body: new Uint8Array(image.bytes),
          }),
          `${name}: image upload`,
        );
        media = { id: value.image, altText: image.alt.slice(0, 4086) };
      }

      const body = {
        author,
        commentary: toLittleText(text),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(media ? { content: { media } } : {}),
      };
      const res = await expectOk(
        await deps.fetch(`${API}/posts`, { method: "POST", headers, body: JSON.stringify(body) }),
        `${name}: create post`,
      );
      const id = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? "";
      if (!id) throw new PublishError(`${name}: post created but no id returned`);
      return { id, url: `https://www.linkedin.com/feed/update/${id}/` };
    },
  };
}
