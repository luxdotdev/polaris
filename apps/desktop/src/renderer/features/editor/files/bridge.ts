/**
 * The Editor's files from the Daemon, through `window.polaris`: versioned
 * reads, saves and per-file watches where the Host announces them (M3-FILES);
 * on an older Daemon, `files.read` with a local hash, no saves, and one shared
 * `files.watch` per Workspace root.
 */
import { polaris } from "../../bridge.ts";
import type { FileVersion } from "../model/buffer.ts";
import {
  byteSize,
  type EditorFiles,
  type FileTarget,
  localHash,
  type ReadResult,
  type WatchListener,
  type WriteResult,
} from "./port.ts";

const decodeText = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

const versionOf = (text: string, modifiedAt: string): FileVersion => ({
  mtimeMs: Date.parse(modifiedAt),
  size: byteSize(text),
  hash: localHash(text),
});

const legacyRead = async ({ hostKey, path }: FileTarget): Promise<ReadResult> => {
  const api = polaris();

  const [content, stat] = await Promise.all([
    api.request("files.read", { hostKey, path, offset: null, length: null }),
    api.request("files.stat", { hostKey, path }),
  ]);

  if (!content.ok) {
    if (/ENOENT|no such file|not found/i.test(content.error.message)) return { kind: "missing" };
    throw new Error(content.error.message);
  }

  const view = content.value.content;
  const text = view.kind === "text" ? view.text : decodeText(view.bytes);

  if (text === null || text.includes("\u0000")) return { kind: "binary", size: content.value.size };

  return { kind: "text", text, version: versionOf(text, stat.ok ? stat.value.modifiedAt : "") };
};

interface RootWatch {
  readonly listeners: Map<string, Set<WatchListener>>;
  readonly close: () => void;
}

const roots = new Map<string, RootWatch>();

/** One shared tree watch per Workspace root; a change re-reads the file for its new version. */
const openRoot = (hostKey: string, root: string): RootWatch => {
  const listeners = new Map<string, Set<WatchListener>>();
  const prefix = root.endsWith("/") ? root : `${root}/`;

  const changed = (relative: string, deleted: boolean) => {
    const path = relative.startsWith("/") ? relative : prefix + relative;
    const set = listeners.get(path);

    if (set === undefined) return;

    if (deleted) {
      for (const listener of set) listener(null);

      return;
    }

    void legacyRead({ hostKey, path, root }).then((result) => {
      const version = result.kind === "text" ? result.version : null;

      for (const listener of set) listener(version);
    });
  };

  const close = polaris().subscribe(
    "files.watch",
    { hostKey, root },
    {
      items: (batches) => {
        for (const batch of batches) {
          for (const change of batch) changed(change.path, change.kind === "deleted");
        }
      },
      end: () => roots.delete(`${hostKey}\u0000${root}`),
    }
  );

  return { listeners, close };
};

const legacyWatch = ({ hostKey, path, root }: FileTarget, listener: WatchListener) => {
  const key = `${hostKey}\u0000${root}`;
  const watcher = roots.get(key) ?? openRoot(hostKey, root);
  const set = watcher.listeners.get(path) ?? new Set();

  roots.set(key, watcher);
  set.add(listener);
  watcher.listeners.set(path, set);

  return () => {
    set.delete(listener);

    if (set.size === 0) watcher.listeners.delete(path);

    if (watcher.listeners.size > 0) return;
    roots.delete(key);
    watcher.close();
  };
};

const missing = (message: string) => /ENOENT|no such file|not found/i.test(message);

const read = async ({ hostKey, path }: FileTarget): Promise<ReadResult> => {
  const result = await polaris().request("files.readVersioned", { hostKey, path });

  if (!result.ok) {
    if (missing(result.error.message)) return { kind: "missing" };
    throw new Error(result.error.message);
  }

  const { content, version } = result.value;
  const text = content.kind === "text" ? content.text : decodeText(content.bytes);

  if (text === null || text.includes("\u0000")) return { kind: "binary", size: version.size };

  return { kind: "text", text, version };
};

const write = async (
  { hostKey, path }: FileTarget,
  text: string,
  expected: FileVersion | null
): Promise<WriteResult> => {
  // A file deleted under the buffer: recreating it waits for `files.create` in the bridge.
  if (expected === null) throw new Error("This file was deleted on disk.");

  const result = await polaris().request("files.write", { hostKey, path, text, expected });

  if (!result.ok) throw new Error(result.error.message);

  if (result.value.kind === "written") return result.value;

  // Refused: read what is there now, so the conflict banner can compare it.
  const current = result.value.current === null ? null : await read({ hostKey, path, root: "" });

  return {
    kind: "changed-on-disk",
    current: current?.kind === "text" ? { text: current.text, version: current.version } : null,
  };
};

const watch = ({ hostKey, path }: FileTarget, listener: WatchListener) => {
  let first = true;

  return polaris().subscribe(
    "files.watchFile",
    { hostKey, path },
    {
      items: (items) => {
        for (const item of items) {
          // The first item is the version as the watch starts: the read already has it.
          if (first) first = false;
          else listener(item.version);
        }
      },
      end: () => {},
    }
  );
};

/** Whether a Host announces a capability; the app reads it from the Host models. */
export type HostCapabilities = (hostKey: string, capability: string) => boolean;

export const createBridgeFiles = (has: HostCapabilities): EditorFiles => ({
  read: (target) => (has(target.hostKey, "files.versioned") ? read(target) : legacyRead(target)),
  write: (target, text, expected) =>
    has(target.hostKey, "files.write")
      ? write(target, text, expected)
      : Promise.resolve({ kind: "unsupported" }),
  watch: (target, listener) =>
    has(target.hostKey, "files.watch-file")
      ? watch(target, listener)
      : legacyWatch(target, listener),
});
