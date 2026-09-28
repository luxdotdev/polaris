/**
 * Search indexes, one per root (a Workspace or a Worktree), built lazily on
 * the first search or watch and dropped after `idleMs` without use and with
 * no active watcher (default 10 minutes). Each index is fff when its native
 * library loads, else the fallback backend.
 */
import { realpath, stat } from "node:fs/promises";
import { FileError } from "@polaris/protocol";
import { Context, Effect, Layer, Queue, Stream } from "effect";
import { resolveHostPath, toFsFailure } from "./fs.ts";
import { makeFallbackBackend } from "./search/fallback.ts";
import { makeFffBackend } from "./search/fff.ts";
import type { FileChange, GrepHit, GrepQuery, PathHit, SearchBackend } from "./search/types.ts";

export interface FileSearchOptions {
  /** Drop an index after this long without a search and with no watcher. */
  readonly idleMs: number;
  /** How often idle indexes are looked for (only while there are any: an idle Daemon sleeps). */
  readonly sweepMs: number;
  /** Set false to force the fallback backend (tests; `POLARIS_FFF=off` does the same). */
  readonly useFff: boolean;
}

export const defaultFileSearchOptions: FileSearchOptions = {
  idleMs: 10 * 60_000,
  sweepMs: 60_000,
  useFff: true,
};

export class FileSearch extends Context.Service<
  FileSearch,
  {
    readonly searchPaths: (
      root: string,
      query: string,
      limit: number
    ) => Effect.Effect<ReadonlyArray<PathHit>, FileError>;
    readonly grep: (
      root: string,
      query: GrepQuery
    ) => Effect.Effect<ReadonlyArray<GrepHit>, FileError>;
    readonly watch: (root: string) => Stream.Stream<ReadonlyArray<FileChange>, FileError>;
    /** Which backend serves `root` right now, if it has an index (diagnostics and tests). */
    readonly backendOf: (root: string) => Effect.Effect<SearchBackend["kind"] | null>;
  }
>()("polaris/daemon/files/FileSearch") {}

interface Index {
  readonly backend: Promise<SearchBackend>;
  lastUsed: number;
  watchers: number;
  /** Searches in flight: an index is never dropped under one. */
  busy: number;
}

const fileError = (path: string, cause: unknown) => {
  const failure = toFsFailure(path, cause);

  return new FileError({ path: failure.path, code: failure.code, message: failure.message });
};

const canonicalRoot = async (input: string): Promise<string> => {
  const path = resolveHostPath(input);
  const real = await realpath(path);
  const stats = await stat(real);

  if (!stats.isDirectory()) {
    throw Object.assign(new Error(`not a directory: ${path}`), { code: "ENOTDIR" });
  }

  return real;
};

export const makeFileSearch = (options: FileSearchOptions) =>
  Effect.gen(function* () {
    const indexes = new Map<string, Index>();
    let timer: ReturnType<typeof setInterval> | undefined;

    const open = (root: string): Index => {
      const existing = indexes.get(root);

      if (existing !== undefined) {
        existing.lastUsed = Date.now();

        return existing;
      }

      const backend = (options.useFff ? makeFffBackend(root) : Promise.resolve(null)).then(
        (fff) => fff ?? makeFallbackBackend(root)
      );

      const index: Index = { backend, lastUsed: Date.now(), watchers: 0, busy: 0 };
      indexes.set(root, index);
      timer ??= setInterval(sweep, options.sweepMs);

      return index;
    };

    const drop = (root: string, index: Index) => {
      indexes.delete(root);
      void index.backend.then((backend) => backend.dispose());
    };

    const sweep = () => {
      const now = Date.now();

      for (const [root, index] of indexes) {
        if (index.watchers === 0 && index.busy === 0 && now - index.lastUsed > options.idleMs) {
          drop(root, index);
        }
      }

      if (indexes.size === 0) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(timer);

        for (const [root, index] of indexes) drop(root, index);
      })
    );

    const withBackend = <A>(input: string, f: (backend: SearchBackend) => Promise<A>) =>
      Effect.tryPromise({
        try: async () => {
          const root = await canonicalRoot(input);
          const index = open(root);
          index.busy++;

          try {
            return await f(await index.backend);
          } finally {
            index.busy--;
            index.lastUsed = Date.now();
          }
        },
        catch: (cause) => fileError(resolveHostPath(input), cause),
      });

    return FileSearch.of({
      searchPaths: (root, query, limit) =>
        withBackend(root, (backend) => backend.searchPaths(query, Math.max(0, limit))),
      grep: (root, query) =>
        withBackend(root, (backend) => backend.grep({ ...query, limit: Math.max(0, query.limit) })),
      watch: (input) =>
        Stream.callback<ReadonlyArray<FileChange>, FileError>((queue) =>
          Effect.gen(function* () {
            const root = yield* Effect.tryPromise({
              try: () => canonicalRoot(input),
              catch: (cause) => fileError(resolveHostPath(input), cause),
            });

            const index = open(root);
            index.watchers++;
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                index.watchers--;
                index.lastUsed = Date.now();
              })
            );

            const backend = yield* Effect.tryPromise({
              try: () => index.backend,
              catch: (cause) => fileError(root, cause),
            });

            // acquireRelease: an interrupt while the watcher is arming still unsubscribes.
            yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: () => backend.watch((batch) => Queue.offerUnsafe(queue, batch)),
                catch: (cause) => fileError(root, cause),
              }),
              (stop) => Effect.sync(stop)
            );
          })
        ),
      backendOf: (input) =>
        Effect.promise(async () => {
          const root = await canonicalRoot(input).catch(() => null);
          const index = root === null ? undefined : indexes.get(root);

          return index === undefined ? null : (await index.backend).kind;
        }),
    });
  });

export const FileSearchLive = (options: Partial<FileSearchOptions> = {}) =>
  Layer.effect(FileSearch, makeFileSearch({ ...defaultFileSearchOptions, ...options }));
