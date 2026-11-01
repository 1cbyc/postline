import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export class LockedError extends Error {}

interface Holder {
  pid: number;
  host: string;
  since: string;
}

function readHolder(file: string): Holder | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof value !== "object" || value === null) return undefined;
    const { pid, host, since } = value as Record<string, unknown>;
    if (typeof pid !== "number" || typeof host !== "string" || typeof since !== "string") return undefined;
    return { pid, host, since };
  } catch {
    return undefined;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Hold an exclusive lock on the project's state directory while `fn` runs, so
 * two postline processes never read and write the ledger at the same time.
 * A lock left behind by a process that died on this machine is taken over;
 * one held from another machine (e.g. a shared folder) has to be removed by hand.
 */
export async function withStateLock<T>(stateDir: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, "publish.lock");
  const me: Holder = { pid: process.pid, host: hostname(), since: new Date().toISOString() };

  let fd: number | undefined;
  for (let tries = 0; fd === undefined; tries++) {
    try {
      fd = openSync(file, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || tries > 0) throw lockError(file, error);
      const holder = readHolder(file);
      if (holder && (holder.host !== me.host || isRunning(holder.pid))) {
        throw new LockedError(
          `another postline process (pid ${holder.pid} on ${holder.host}, since ${holder.since}) is using ${stateDir}; ` +
            `if it is no longer running, delete ${file}`,
        );
      }
      if (!holder) throw new LockedError(`${file} exists but is unreadable; if no postline process is running, delete it`);
      rmSync(file, { force: true });
    }
  }
  try {
    writeSync(fd, JSON.stringify(me));
  } finally {
    closeSync(fd);
  }

  try {
    return await fn();
  } finally {
    if (readHolder(file)?.pid === me.pid) rmSync(file, { force: true });
  }
}

function lockError(file: string, error: unknown): Error {
  if ((error as NodeJS.ErrnoException).code === "EEXIST") return new LockedError(`another postline process just took ${file}`);
  return error instanceof Error ? error : new Error(String(error));
}
