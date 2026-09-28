/**
 * The fff worker: owns every fff index (one `FileFinder` per root) and runs
 * their searches, so fff's synchronous FFI calls never block the Daemon's
 * event loop. `fff.ts` is its only client; the protocol is `WorkerRequest`
 * in, `WorkerReply` / `WorkerWatchEvent` out.
 *
 * Also a standalone entrypoint of the compiled binary (scripts/build-daemon.ts).
 */
import type { FileFinder as FileFinderType } from "@ff-labs/fff-bun";
import { fffGrep, fffSearchPaths } from "./fffSearch.ts";
import type { FileChange, GrepQuery } from "./types.ts";

export type WorkerRequest = { readonly id: number } & (
  | {
      readonly op: "open";
      readonly index: number;
      readonly root: string;
      readonly frecencyDbPath: string;
      readonly historyDbPath: string;
    }
  | {
      readonly op: "searchPaths";
      readonly index: number;
      readonly query: string;
      readonly limit: number;
    }
  | { readonly op: "grep"; readonly index: number; readonly query: GrepQuery }
  | { readonly op: "watch"; readonly index: number; readonly subscription: number }
  | { readonly op: "unwatch"; readonly index: number; readonly subscription: number }
  | { readonly op: "close"; readonly index: number }
);

export type WorkerReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: string;
      /** fff can't serve this: its library doesn't load here, or it refused the root. Use the fallback. */
      readonly unavailable?: "library" | "root";
    };

export interface WorkerWatchEvent {
  readonly subscription: number;
  readonly changes: ReadonlyArray<FileChange>;
}

/** How long the first search waits for the initial scan before answering from a partial index. */
const SCAN_WAIT_MS = 5_000;

const mapKind = (kind: string): FileChange["kind"] | null => {
  switch (kind) {
    case "created":
      return "created";
    case "modified":
      return "modified";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return null;
  }
};

interface Index {
  readonly root: string;
  readonly finder: FileFinderType;
  scanned: Promise<unknown> | undefined;
  readonly subscriptions: Map<number, () => void>;
}

declare const self: Worker;

let FileFinder: typeof FileFinderType | null | undefined;
const loadError = { message: "" };
const load = async (): Promise<typeof FileFinderType | null> => {
  if (FileFinder !== undefined) return FileFinder;
  try {
    FileFinder = (await import("@ff-labs/fff-bun")).FileFinder;
  } catch (cause) {
    loadError.message = cause instanceof Error ? cause.message : String(cause);
    FileFinder = null;
  }
  return FileFinder;
};

const indexes = new Map<number, Index>();

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const ready = (index: Index) => {
  index.scanned ??= index.finder.waitForScan(SCAN_WAIT_MS);
  return index.scanned;
};

const get = (id: number): Index => {
  const index = indexes.get(id);
  if (index === undefined) throw new Error(`no fff index ${id}`);
  return index;
};

class Unavailable extends Error {
  constructor(
    readonly reason: "library" | "root",
    message: string
  ) {
    super(message);
  }
}

const handle = async (request: WorkerRequest): Promise<unknown> => {
  switch (request.op) {
    case "open": {
      const Finder = await load();
      if (Finder === null) throw new Unavailable("library", loadError.message);
      let created: ReturnType<typeof Finder.create>;
      try {
        created = Finder.create({
          basePath: request.root,
          frecencyDbPath: request.frecencyDbPath,
          historyDbPath: request.historyDbPath,
        });
      } catch (cause) {
        // Thrown (not returned) when the native library itself fails to load.
        FileFinder = null;
        throw new Unavailable("library", cause instanceof Error ? cause.message : String(cause));
      }
      if (!created.ok) throw new Unavailable("root", created.error);
      indexes.set(request.index, {
        root: request.root,
        finder: created.value,
        scanned: undefined,
        subscriptions: new Map(),
      });
      return null;
    }
    case "searchPaths": {
      const index = get(request.index);
      await ready(index);
      return fffSearchPaths(index.finder, index.root, request.query, request.limit);
    }
    case "grep": {
      const index = get(request.index);
      await ready(index);
      return fffGrep(index.finder, index.root, request.query);
    }
    case "watch": {
      const index = get(request.index);
      // fff drops subscriptions made before its initial scan and watcher are ready.
      await ready(index);
      const deadline = Date.now() + SCAN_WAIT_MS;
      while (!(unwrap(index.finder.getScanProgress()).isWatcherReady || Date.now() > deadline)) {
        await Bun.sleep(20);
      }
      const subscription = request.subscription;
      const stop = unwrap(
        index.finder.watch((events) => {
          const changes: Array<FileChange> = [];
          for (const event of events) {
            const kind = mapKind(event.kind);
            // `rescan` means events were lost: report the root as modified so Clients re-read.
            changes.push(
              kind === null ? { path: index.root, kind: "modified" } : { path: event.path, kind }
            );
          }
          if (changes.length > 0) {
            self.postMessage({ subscription, changes } satisfies WorkerWatchEvent);
          }
        })
      );
      index.subscriptions.set(subscription, stop);
      return null;
    }
    case "unwatch": {
      const index = indexes.get(request.index);
      index?.subscriptions.get(request.subscription)?.();
      index?.subscriptions.delete(request.subscription);
      return null;
    }
    case "close": {
      const index = indexes.get(request.index);
      if (index !== undefined) {
        indexes.delete(request.index);
        for (const stop of index.subscriptions.values()) stop();
        index.finder.destroy();
      }
      return null;
    }
  }
};

self.onmessage = (message: MessageEvent<WorkerRequest>) => {
  const request = message.data;
  handle(request).then(
    (value) => self.postMessage({ id: request.id, ok: true, value } satisfies WorkerReply),
    (cause: unknown) =>
      self.postMessage({
        id: request.id,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
        ...(cause instanceof Unavailable ? { unavailable: cause.reason } : {}),
      } satisfies WorkerReply)
  );
};
