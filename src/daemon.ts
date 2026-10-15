export interface DaemonOptions {
  intervalMs: number;
  signal: AbortSignal;
  task: () => Promise<number>;
  log: (message: string) => void;
  error: (message: string) => void;
}

function waitForNextRun(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Run one publishing check at a time until the caller requests shutdown. */
export async function runDaemon(options: DaemonOptions): Promise<void> {
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1) {
    throw new Error("daemon interval must be a positive whole number of milliseconds");
  }

  while (!options.signal.aborted) {
    const startedAt = new Date();
    options.log(`[${startedAt.toISOString()}] checking for due posts`);
    try {
      const code = await options.task();
      if (code !== 0) options.error(`[${new Date().toISOString()}] publish check completed with errors`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
      options.error(`[${new Date().toISOString()}] publish check failed\n${message}`);
    }

    if (!options.signal.aborted) await waitForNextRun(options.intervalMs, options.signal);
  }
}
