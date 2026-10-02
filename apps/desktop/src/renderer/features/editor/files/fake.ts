/**
 * Files in memory, behaving like a Daemon with `files.write`: versions,
 * rejected stale saves, and watches. Tests and the `#editor/...` previews
 * use it; `agentWrite` stands in for an Agent Session editing a file.
 */
import type { FileVersion } from "../model/buffer.ts";
import {
  byteSize,
  type EditorFiles,
  type FileTarget,
  localHash,
  type WatchListener,
} from "./port.ts";

interface Entry {
  text: string;
  version: FileVersion;
}

export interface FakeFiles extends EditorFiles {
  /** Writes as an agent would: no version check, watchers told. */
  readonly agentWrite: (hostKey: string, path: string, text: string) => void;
  readonly remove: (hostKey: string, path: string) => void;
  readonly text: (hostKey: string, path: string) => string | null;
  /** How many watches are open, for the no-idle-cost checks. */
  readonly watching: () => number;
}

export interface FakeOptions {
  /** Every read and write waits this long, like a remote Host. */
  readonly latencyMs?: number;
  /** Hosts whose Daemon predates `files.write`. */
  readonly readOnlyHosts?: ReadonlyArray<string>;
}

const key = (hostKey: string, path: string) => `${hostKey}\u0000${path}`;

export const createFakeFiles = (
  seed: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
  options: FakeOptions = {}
): FakeFiles => {
  const entries = new Map<string, Entry>();
  const watchers = new Map<string, Set<WatchListener>>();
  let clock = Date.parse("2026-10-02T09:00:00Z");

  const versionOf = (text: string): FileVersion => {
    clock += 1000;

    return { mtimeMs: clock, size: byteSize(text), hash: localHash(text) };
  };

  for (const [hostKey, files] of Object.entries(seed)) {
    for (const [path, text] of Object.entries(files)) {
      entries.set(key(hostKey, path), { text, version: versionOf(text) });
    }
  }

  const wait = () =>
    new Promise<void>((resolve) => {
      if ((options.latencyMs ?? 0) === 0) resolve();
      else setTimeout(resolve, options.latencyMs);
    });

  const notify = (k: string, version: FileVersion | null) => {
    for (const listener of watchers.get(k) ?? []) listener(version);
  };

  const put = (k: string, text: string) => {
    const version = versionOf(text);

    entries.set(k, { text, version });
    notify(k, version);

    return version;
  };

  const write = async (target: FileTarget, text: string, expected: FileVersion | null) => {
    await wait();

    if (options.readOnlyHosts?.includes(target.hostKey) === true) {
      return { kind: "unsupported" as const };
    }

    const k = key(target.hostKey, target.path);
    const current = entries.get(k) ?? null;

    const stale =
      expected === null
        ? current !== null
        : current === null || current.version.hash !== expected.hash;

    if (stale) {
      return {
        kind: "changed-on-disk" as const,
        current: current === null ? null : { text: current.text, version: current.version },
      };
    }

    return { kind: "written" as const, version: put(k, text) };
  };

  return {
    read: async ({ hostKey, path }) => {
      await wait();
      const entry = entries.get(key(hostKey, path));

      if (entry === undefined) return { kind: "missing" };

      return entry.text.includes("\u0000")
        ? { kind: "binary", size: entry.version.size }
        : { kind: "text", text: entry.text, version: entry.version };
    },
    write,
    watch: ({ hostKey, path }, listener) => {
      const k = key(hostKey, path);
      const set = watchers.get(k) ?? new Set();

      set.add(listener);
      watchers.set(k, set);

      return () => {
        set.delete(listener);

        if (set.size === 0) watchers.delete(k);
      };
    },
    agentWrite: (hostKey, path, text) => void put(key(hostKey, path), text),
    remove: (hostKey, path) => {
      const k = key(hostKey, path);

      entries.delete(k);
      notify(k, null);
    },
    text: (hostKey, path) => entries.get(key(hostKey, path))?.text ?? null,
    watching: () => [...watchers.values()].reduce((n, s) => n + s.size, 0),
  };
};
