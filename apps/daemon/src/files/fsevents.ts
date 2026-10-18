import { mkdtempSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** How long a probe keeps writing before it gives up and lets the caller go on regardless. */
const PROBE_LIMIT_MS = 5000;

const PROBE_MAX_INTERVAL_MS = 100;

/**
 * Proves Bun has rebuilt its one FSEvents stream: a fresh directory's watch, registered after
 * the caller's, reports one of the writes made into it.
 */
const probe = async (): Promise<void> => {
  let directory: string;

  try {
    directory = realpathSync.native(mkdtempSync(join(tmpdir(), "polaris-fsevents-")));
  } catch {
    return;
  }

  const seen = Promise.withResolvers<true>();
  const deadline = performance.now() + PROBE_LIMIT_MS;
  let watcher: ReturnType<typeof watch> | undefined;

  try {
    watcher = watch(directory, { persistent: false }, () => seen.resolve(true));
    watcher.on("error", () => seen.resolve(true));

    // A write made before the rebuilt stream starts is lost, so write again until one arrives.
    for (let i = 0, wait = 2; performance.now() < deadline; i++) {
      writeFileSync(join(directory, String(i)), "");

      if (await Promise.race([seen.promise, Bun.sleep(wait).then(() => false)])) return;
      wait = Math.min(wait * 2, PROBE_MAX_INTERVAL_MS);
    }
  } catch {
    // A full temp directory or no watch left to open: go on as Bun would.
  } finally {
    watcher?.close();
    rmSync(directory, { recursive: true, force: true });
  }
};

let running: Promise<void> | null = null;

let following: Promise<void> | null = null;

/**
 * Resolves once every `fs.watch` opened before the call reports changes (ADR 0072). Bun on
 * macOS starts its FSEvents stream later, on another thread; elsewhere this resolves at once.
 */
export const nativeWatchesLive = (): Promise<void> => {
  if (process.platform !== "darwin") return Promise.resolve();

  if (running === null) {
    running = probe().finally(() => {
      running = null;
    });

    return running;
  }

  // The running probe registered before this caller's watch, so it proves nothing for it.
  following ??= running.then(() => {
    following = null;

    return nativeWatchesLive();
  });

  return following;
};
