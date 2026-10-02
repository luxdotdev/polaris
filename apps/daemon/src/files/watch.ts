import { type FSWatcher, watch } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { FileError, type FileVersion } from "@polaris/protocol";
import { Cause, Effect, Option, Queue, Stream } from "effect";
import { FileSearch } from "./FileSearch.ts";
import { resolveHostPath, toFsFailure } from "./fs.ts";
import { currentVersion, sameVersion } from "./version.ts";

interface Listener {
  readonly name: string;
  readonly changed: () => void;
  readonly failed: (cause: unknown) => void;
}

interface DirectoryWatch {
  readonly watcher: FSWatcher;
  readonly listeners: Set<Listener>;
}

const directories = new Map<string, DirectoryWatch>();

/** Shared parent watches survive atomic replacements; no polling or debounce timer. */
const subscribe = (path: string, listener: Listener): (() => void) => {
  const directory = dirname(path);
  let entry = directories.get(directory);

  if (!entry) {
    const listeners = new Set<Listener>();

    // The Daemon listener owns process lifetime, including while tabs are open.
    const watcher = watch(directory, { persistent: false }, (_event, filename) => {
      const name = filename?.toString();

      for (const item of listeners) if (!name || name === item.name) item.changed();
    });

    watcher.on("error", (cause) => {
      for (const item of listeners) item.failed(cause);
    });
    entry = { watcher, listeners };
    directories.set(directory, entry);
  }

  const current = entry;
  current.listeners.add(listener);

  return () => {
    current.listeners.delete(listener);

    if (current.listeners.size === 0) {
      current.watcher.close();
      directories.delete(directory);
    }
  };
};

/** Diagnostic count for watcher lifecycle tests and benchmarks. */
export const openFileWatchCount = () => directories.size;

export const watchFile = (input: string) => {
  const path = resolveHostPath(input);

  return Stream.callback<{ path: string; version: FileVersion | null }, FileError>(
    (queue) =>
      Effect.gen(function* () {
        const watchedPath = yield* Effect.tryPromise({
          try: async () => join(await realpath(dirname(path)), basename(path)),
          catch: (cause) => {
            const error = toFsFailure(path, cause);

            return new FileError({ path, code: error.code, message: error.message });
          },
        });

        const fail = (cause: unknown) => {
          const error = toFsFailure(path, cause);
          Queue.failCauseUnsafe(
            queue,
            Cause.fail(new FileError({ path, code: error.code, message: error.message }))
          );
        };

        let closed = false;
        let running = false;
        let pending = false;
        let initialized = false;
        let last: FileVersion | null = null;
        let stopTarget = () => {};

        let target: string | null = null;

        const changed = () => {
          pending = true;

          if (running || closed) return;
          running = true;
          void (async () => {
            while (pending && !closed) {
              pending = false;
              const nextTarget = await realpath(path).catch(() => null);

              if (closed) return;

              if (target !== nextTarget) {
                stopTarget();
                target = nextTarget;
                stopTarget =
                  target && target !== watchedPath
                    ? subscribe(target, { name: basename(target), changed, failed: fail })
                    : () => {};
              }

              const version = await currentVersion(path);

              if (!closed && (!initialized || !sameVersion(version, last))) {
                initialized = true;
                last = version;
                Queue.offerUnsafe(queue, { path, version });
              }
            }
          })()
            .catch(fail)
            .finally(() => {
              running = false;

              if (pending && !closed) changed();
            });
        };

        yield* Effect.acquireRelease(
          Effect.try({
            try: () => subscribe(watchedPath, { name: basename(path), changed, failed: fail }),
            catch: (cause) => {
              const error = toFsFailure(path, cause);

              return new FileError({ path, code: error.code, message: error.message });
            },
          }),
          (stop) =>
            Effect.sync(() => {
              closed = true;
              stop();
              stopTarget();
            })
        );
        const search = yield* Effect.serviceOption(FileSearch);

        if (Option.isSome(search)) {
          yield* search.value
            .watchIndexedFile(watchedPath, changed)
            .pipe(Effect.catch(() => Effect.void));
        }

        changed();
      }).pipe(Effect.catch((error) => Queue.fail(queue, error))),
    { bufferSize: 1, strategy: "sliding" }
  );
};
