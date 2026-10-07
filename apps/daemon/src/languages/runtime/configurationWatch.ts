import { realpath } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { watchRoot } from "../../files/search/watch.ts";
import { subscribeDirectoryChanges } from "../../files/watch.ts";
import { Schema } from "effect";
import { LanguageContextEvent } from "@polaris/protocol";
import { ancestors, readJson } from "../discovery/files.ts";
import type { BrokerOptions, Entry } from "./types.ts";

interface WatchGroup {
  owners: Set<Entry>;
  stops: (() => void)[];
  metadataStops: (() => void)[];
  timer?: ReturnType<typeof setTimeout> | undefined;
  pending: Set<string>;
  closed: boolean;
  tail: Promise<void>;
  version: string | null;
}

const Manifest = Schema.Struct({ version: Schema.String });

function manifestPaths(root: string, group: WatchGroup) {
  const paths = new Set([join(root, "node_modules/typescript/package.json")]);

  for (const entry of group.owners) {
    for (const base of ancestors(root, entry.facts.projectRoot))
      paths.add(join(base, "node_modules/typescript/package.json"));

    if (entry.facts.sdk !== null) paths.add(join(entry.facts.sdk, "package.json"));
  }

  return paths;
}

const versionAt = async (root: string, group: WatchGroup) => {
  const versions: (string | null)[] = [];

  for (const path of manifestPaths(root, group)) {
    const version = await readJson(path)
      .then((manifest) => Schema.decodeUnknownSync(Manifest)(manifest).version)
      .catch(() => null);

    versions.push(version);
  }

  return JSON.stringify(versions);
};

function reportFailure(group: WatchGroup) {
  for (const entry of group.owners)
    entry.events.emit(
      LanguageContextEvent.cases.Log.make({
        context: entry.identity,
        level: "warning",
        message: "Language configuration watcher could not refresh",
      })
    );
}

export function configurationWatches(
  options: BrokerOptions,
  restart: (entry: Entry) => Promise<void>
) {
  const groups = new Map<string, WatchGroup>();
  const tasks = new Set<Promise<void>>();
  let closed = false;

  function track(task: Promise<void>) {
    tasks.add(task);
    void task.finally(() => tasks.delete(task)).catch(() => {});
  }

  async function metadata(root: string, group: WatchGroup, changed: (path: string) => void) {
    for (const stop of group.metadataStops) stop();
    group.metadataStops = [];

    const directories = new Set([root]);

    for (const path of manifestPaths(root, group)) {
      directories.add(dirname(path));
      directories.add(dirname(dirname(path)));
      directories.add(dirname(dirname(dirname(path))));
    }

    for (const directory of directories) {
      const canonical = await realpath(directory).catch(() => null);

      if (group.closed) return;

      if (canonical === null) continue;
      group.metadataStops.push(
        subscribeDirectoryChanges(canonical, (path) => {
          if (["node_modules", "typescript", "package.json"].includes(basename(path)))
            changed(path);
        })
      );
    }
  }

  async function flush(root: string, group: WatchGroup, changed: (path: string) => void) {
    const paths = [...group.pending];
    group.pending.clear();
    await metadata(root, group, changed);
    const version = await versionAt(root, group);

    const relevant =
      paths.some((path) => /^tsconfig(?:\..+)?\.json$/.test(basename(path))) ||
      version !== group.version;

    group.version = version;

    if (!relevant || group.closed) return;
    options.invalidateDiscovery();

    for (const entry of group.owners) {
      if (group.closed || !group.owners.has(entry)) continue;
      await restart(entry).catch(() => reportFailure(group));
    }
  }

  function watch(entry: Entry) {
    if (closed || entry.facts.providerId !== "typescript-language-server") return;
    const root = entry.facts.checkout.path;
    const existing = groups.get(root);

    if (existing !== undefined) {
      existing.owners.add(entry);

      return;
    }

    const group: WatchGroup = {
      owners: new Set([entry]),
      stops: [],
      metadataStops: [],
      pending: new Set(),
      closed: false,
      tail: Promise.resolve(),
      version: null,
    };

    groups.set(root, group);

    const changed = (path: string) => {
      if (group.closed) return;

      if (
        !/^tsconfig(?:\..+)?\.json$/.test(basename(path)) &&
        !["node_modules", "typescript", "package.json"].includes(basename(path))
      )
        return;
      group.pending.add(path);
      clearTimeout(group.timer);
      group.timer = setTimeout(() => {
        group.timer = undefined;
        group.tail = group.tail
          .then(() => flush(root, group, changed))
          .catch(() => reportFailure(group));
        track(group.tail);
      }, options.changeDebounceMs ?? 300);
    };

    track(
      (async () => {
        group.version = await versionAt(root, group);

        const stop = await watchRoot(root, (_event, path) => changed(path), {
          includeNonGit: true,
        });

        if (group.closed) {
          stop();

          return;
        }

        group.stops.push(stop);
        await metadata(root, group, changed);
      })().catch(() => {
        reportFailure(group);
        stopGroup(root, group);
      })
    );
  }

  function stopGroup(root: string, group: WatchGroup) {
    group.closed = true;
    clearTimeout(group.timer);

    for (const stop of [...group.stops, ...group.metadataStops]) stop();
    groups.delete(root);
  }

  function unwatch(entry: Entry) {
    const root = entry.facts.checkout.path;
    const group = groups.get(root);

    if (group === undefined) return;
    group.owners.delete(entry);

    if (group.owners.size === 0) stopGroup(root, group);
  }

  async function close() {
    closed = true;

    for (const [root, group] of groups) stopGroup(root, group);
    await Promise.all(tasks);
  }

  return { watch, unwatch, close };
}
