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
  requestTimeoutMs?: number;
}

export async function fetchWithTimeout(
  deps: AdapterDeps,
  input: string | URL | Request,
  init: RequestInit | undefined,
  what: string,
): Promise<Response> {
  const timeoutMs = deps.requestTimeoutMs ?? 30_000;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const callerSignal = init?.signal;
  const abortFromCaller = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    return await deps.fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new PublishError(`${what} timed out after ${timeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
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

/**
 * The request that creates the post may have reached the network, and we
 * cannot tell whether it went out. Never retried automatically.
 */
export class DeliveryUncertainError extends PublishError {}

/** 4xx means the network looked at the request and turned it down. */
function definitelyRejected(error: unknown): boolean {
  return error instanceof PublishError && error.status !== undefined && error.status >= 400 && error.status < 500;
}

/**
 * Wrap the one request that makes a post public, plus reading its response.
 * Anything other than a clear rejection (timeouts, dropped connections, 5xx,
 * an unreadable 2xx) becomes a DeliveryUncertainError so it is not retried.
 */
export async function deliver<T>(what: string, send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (definitelyRejected(error) || error instanceof DeliveryUncertainError) throw error;
    // PublishErrors already name the request; raw fetch/JSON errors don't.
    if (error instanceof PublishError) {
      throw new DeliveryUncertainError(`${error.message} (it may have gone out)`, error.status, error.body);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new DeliveryUncertainError(`${what}: ${message} (it may have gone out)`);
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
