import { type FSWatcher, watch as fsWatch } from "node:fs";
import { opendir } from "node:fs/promises";
import { join, relative } from "node:path";
import { findRepoRoot, runGit } from "../../git/git.ts";

export const WALK_SKIP = new Set([".git", "node_modules", ".hg", ".svn"]);

export const WATCH_MAX_DIRECTORIES = 256;

const WATCH_MAX_ENTRIES = 4096;

type Changed = (event: string, path: string) => void;

type OpenWatch = (path: string, recursive: boolean, changed: Changed) => FSWatcher;

const openWatch: OpenWatch = (path, recursive, changed) =>
  fsWatch(path, { recursive }, (event, name) => {
    if (name !== null) changed(event, join(path, name.toString()));
  });

/** FSEvents on macOS; bounded git watches and no non-git root watches elsewhere. */
export const watchRoot = async (
  root: string,
  changed: Changed,
  options: { readonly platform?: NodeJS.Platform; readonly open?: OpenWatch } = {}
): Promise<() => void> => {
  const recursive = (options.platform ?? process.platform) === "darwin";
  const open = options.open ?? openWatch;
  const watchers = new Map<string, FSWatcher>();
  let stopped = false;
  let inRepo = false;
  let entries = 0;
  let scanning = Promise.resolve();
  const pending = new Set<string>();

  const stop = () => {
    stopped = true;

    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };

  const ignored = async (path: string) => {
    const result = await runGit(root, ["check-ignore", "--no-index", "-q", "--", path + "/"], {
      okCodes: [1],
      timeoutMs: 1000,
    });

    return result.code === 0;
  };

  const visit = async (directory: string): Promise<Array<string>> => {
    if (stopped || ++entries > WATCH_MAX_ENTRIES) return [];

    if (directory !== root && (watchers.has(directory) || (await ignored(directory)))) return [];
    const children: Array<string> = [];

    try {
      const dir = await opendir(directory);

      if (stopped) {
        await dir.close();

        return [];
      }

      for await (const entry of dir) {
        if (stopped || ++entries > WATCH_MAX_ENTRIES) break;

        if (entry.isDirectory() && !WALK_SKIP.has(entry.name))
          children.push(join(directory, entry.name));
      }

      if (!stopped && entries <= WATCH_MAX_ENTRIES && !watchers.has(directory)) arm(directory);
    } catch {
      // Directories may disappear or become unreadable during discovery.
    }

    return children;
  };

  const scan = async (start: string) => {
    const queue = [start];

    while (
      !stopped &&
      queue.length > 0 &&
      watchers.size < WATCH_MAX_DIRECTORIES &&
      entries < WATCH_MAX_ENTRIES
    ) {
      queue.push(...(await visit(queue.shift()!)));
    }
  };

  const enqueue = (path: string) => {
    if (stopped || watchers.size >= WATCH_MAX_DIRECTORIES || entries >= WATCH_MAX_ENTRIES) return;

    if (pending.has(path) || pending.size >= WATCH_MAX_DIRECTORIES) return;
    pending.add(path);
    scanning = scanning
      .then(() => scan(path))
      .catch(() => undefined)
      .finally(() => pending.delete(path));
  };

  const arm = (directory: string) => {
    const watcher = open(directory, recursive, (event, path) => {
      if (
        relative(root, path)
          .split(/[\\/]/)
          .some((part) => WALK_SKIP.has(part))
      )
        return;
      changed(event, path);

      if (inRepo && !recursive && event === "rename") enqueue(path);
    });

    // Home directories can hold sockets that Bun reports as ENXIO error events.
    watcher.on("error", () => undefined);
    watchers.set(directory, watcher);
  };

  try {
    if (recursive) arm(root);
    else inRepo = (await findRepoRoot(root)) !== null;

    if (inRepo) {
      scanning = scan(root);
      await scanning;
    }

    return stop;
  } catch (cause) {
    stop();
    throw cause;
  }
};
