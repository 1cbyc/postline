import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertSafeFileStem } from "./path.js";

export type EntryStatus = "attempting" | "published" | "failed" | "skipped";

export interface Entry {
  status: EntryStatus;
  updatedAt: string;
  attempts: number;
  remoteId?: string;
  url?: string;
  error?: string;
}

interface LedgerFile {
  version: 1;
  entries: Record<string, Entry>;
}

const ENTRY_STATUSES = new Set<EntryStatus>(["attempting", "published", "failed", "skipped"]);

function readLedger(file: string): LedgerFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`could not parse ledger ${file}: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`ledger ${file} must be an object`);
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1 || typeof root.entries !== "object" || root.entries === null || Array.isArray(root.entries)) {
    throw new Error(`ledger ${file} must have version 1 and an entries mapping`);
  }
  const entries: Record<string, Entry> = {};
  for (const [key, value] of Object.entries(root.entries as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}::[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key)) {
      throw new Error(`ledger entry key ${key} is invalid`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`ledger entry ${key} must be an object`);
    const entry = value as Record<string, unknown>;
    if (typeof entry.status !== "string" || !ENTRY_STATUSES.has(entry.status as EntryStatus)) throw new Error(`ledger entry ${key} has an invalid status`);
    if (typeof entry.updatedAt !== "string" || Number.isNaN(Date.parse(entry.updatedAt))) throw new Error(`ledger entry ${key} has an invalid updatedAt`);
    if (typeof entry.attempts !== "number" || !Number.isInteger(entry.attempts) || entry.attempts < 0) {
      throw new Error(`ledger entry ${key} has invalid attempts`);
    }
    for (const field of ["remoteId", "url", "error"] as const) {
      if (entry[field] != null && typeof entry[field] !== "string") throw new Error(`ledger entry ${key}.${field} must be a string`);
    }
    entries[key] = {
      status: entry.status as EntryStatus,
      updatedAt: entry.updatedAt,
      attempts: entry.attempts,
      ...(typeof entry.remoteId === "string" ? { remoteId: entry.remoteId } : {}),
      ...(typeof entry.url === "string" ? { url: entry.url } : {}),
      ...(typeof entry.error === "string" ? { error: entry.error } : {}),
    };
  }
  return { version: 1, entries };
}

/**
 * Record of what has been sent where. It lives in the repo so the scheduler
 * can be stateless (a CI job) and history is reviewable in git.
 */
export class Ledger {
  private data: LedgerFile;
  readonly file: string;

  constructor(stateDir: string) {
    this.file = join(stateDir, "ledger.json");
    this.data = existsSync(this.file) ? readLedger(this.file) : { version: 1, entries: {} };
  }

  static key(postId: string, channel: string): string {
    assertSafeFileStem(postId, "post id");
    assertSafeFileStem(channel, "channel name");
    if (channel.length > 64) throw new Error("channel name must be 64 characters or fewer");
    return `${postId}::${channel}`;
  }

  get(postId: string, channel: string): Entry | undefined {
    return this.data.entries[Ledger.key(postId, channel)];
  }

  set(postId: string, channel: string, patch: Partial<Entry> & { status: EntryStatus }, now = new Date()): Entry {
    const k = Ledger.key(postId, channel);
    const prev = this.data.entries[k];
    const next: Entry = {
      attempts: prev?.attempts ?? 0,
      ...prev,
      ...patch,
      updatedAt: now.toISOString(),
    };
    if (patch.status === "attempting") next.attempts = (prev?.attempts ?? 0) + 1;
    if (patch.status === "published") delete next.error;
    this.data.entries[k] = next;
    return next;
  }

  reset(postId: string, channel: string): boolean {
    return delete this.data.entries[Ledger.key(postId, channel)];
  }

  all(): [string, Entry][] {
    return Object.entries(this.data.entries);
  }

  save(): void {
    mkdirSync(join(this.file, ".."), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const sorted: LedgerFile = {
      version: 1,
      entries: Object.fromEntries(Object.entries(this.data.entries).sort(([a], [b]) => a.localeCompare(b))),
    };
    writeFileSync(tmp, JSON.stringify(sorted, null, 2) + "\n");
    renameSync(tmp, this.file);
  }
}
