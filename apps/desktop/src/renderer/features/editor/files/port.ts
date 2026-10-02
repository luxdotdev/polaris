/**
 * What the Editor needs from a Host's files (spec §2): a versioned read, a
 * versioned write that refuses to overwrite a newer disk, and a watch on one
 * open file. `bridge.ts` serves it from the Daemon, `fake.ts` from memory.
 */
import type { DiskText, FileVersion } from "../model/buffer.ts";

export type ReadResult =
  | ({ readonly kind: "text" } & DiskText)
  /** Not text: the Editor says so rather than showing bytes. */
  | { readonly kind: "binary"; readonly size: number }
  | { readonly kind: "missing" };

export type WriteResult =
  | { readonly kind: "written"; readonly version: FileVersion }
  /** The disk moved on since `expected`; `current` is null when the file is gone. */
  | { readonly kind: "changed-on-disk"; readonly current: DiskText | null }
  /** The Host's Daemon predates `files.write`. */
  | { readonly kind: "unsupported" };

/** A watched file changed: its new version, or null once it is deleted. */
export type WatchListener = (version: FileVersion | null) => void;

export interface FileTarget {
  readonly hostKey: string;
  /** Absolute on the Host. */
  readonly path: string;
  /** The Workspace's root, for Daemons that only watch whole trees. */
  readonly root: string;
}

export interface EditorFiles {
  /** Rejects with an `Error` whose message is the Daemon's reason. */
  readonly read: (target: FileTarget) => Promise<ReadResult>;
  readonly write: (
    target: FileTarget,
    text: string,
    expected: FileVersion | null
  ) => Promise<WriteResult>;
  /** Calls back on every change after it starts; returns the unsubscribe. */
  readonly watch: (target: FileTarget, listener: WatchListener) => () => void;
}

/** FNV-1a over UTF-16 units, for Daemons that don't hash: enough to tell two texts apart. */
export const localHash = (text: string): string => {
  let h = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  return `fnv:${h.toString(16)}:${text.length}`;
};

/** UTF-8 byte length, the size a Daemon reports. */
export const byteSize = (text: string) => new TextEncoder().encode(text).length;
