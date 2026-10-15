import type { Post } from "../content.js";

export interface MediaInput {
  bytes: Buffer;
  mime: "image/png" | "image/jpeg";
  alt: string;
  width?: number;
  height?: number;
}

export interface PublishInput {
  post: Post;
  channel: string;
  text: string;
  image?: MediaInput;
}

export interface PublishResult {
  id: string;
  url?: string;
}

export interface Adapter {
  publish(input: PublishInput): Promise<PublishResult>;
}

export type FetchLike = typeof fetch;

export interface AdapterDeps {
  env: NodeJS.ProcessEnv;
  fetch: FetchLike;
  root: string;
}

export class PublishError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
  }
}

export async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  let body = "";
  try {
    body = (await res.text()).slice(0, 500);
  } catch {}
  throw new PublishError(`${what} failed: HTTP ${res.status}${body ? ` ${body}` : ""}`, res.status, body);
}

export function requireEnv(env: NodeJS.ProcessEnv, name: string, channel: string): string {
  const v = env[name];
  if (!v) throw new PublishError(`${channel}: environment variable ${name} is not set`);
  return v;
}
