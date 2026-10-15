import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Record of what has been sent where. It lives in the repo so the scheduler
 * can be stateless (a CI job) and history is reviewable in git.
 */
export class Ledger {
  private data: LedgerFile;
  readonly file: string;

  constructor(stateDir: string) {
    this.file = join(stateDir, "ledger.json");
    this.data = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, "utf8")) as LedgerFile)
      : { version: 1, entries: {} };
  }

  static key(postId: string, channel: string): string {
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
