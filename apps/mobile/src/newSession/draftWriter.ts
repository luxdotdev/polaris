/** A new session's drafts as data: one store key per Host and Workspace, written after a pause. */
import type { Target } from "./model.ts";

const PREFIX = "polaris.newSession.draft";

/** Typing pauses this long before the draft is written. */
export const SAVE_DELAY_MS = 500;

export interface DraftStore {
  readonly load: (key: string) => Promise<string | null>;
  /** Empty text forgets the key. */
  readonly save: (key: string, text: string) => Promise<void>;
}

/** FNV-1a: SecureStore keys allow only letters, digits, `.`, `-` and `_`; Host ids don't. */
const fnv = (text: string): string => {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
};

/** The store key of a Host and Workspace's draft. */
export const draftKey = (target: Target): string =>
  `${PREFIX}.${fnv(target.hostId)}.${fnv(target.workspaceId)}`;

export interface DraftWriter {
  /** Writes `text` under `key` once typing pauses; a pending write to another key goes first. */
  readonly write: (key: string, text: string) => void;
  /** Writes what is pending now. */
  readonly flush: () => Promise<void>;
  /** Drops a pending write to `key` and forgets its draft. */
  readonly clear: (key: string) => Promise<void>;
}

/** `onSaved` hears each write that landed, with the text it wrote. */
export const draftWriter = (
  store: DraftStore,
  onSaved: (key: string, text: string) => void,
  delayMs = SAVE_DELAY_MS
): DraftWriter => {
  let pending: {
    readonly key: string;
    readonly text: string;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;

  const flush = async () => {
    if (pending === null) return;
    const { key, text, timer } = pending;

    clearTimeout(timer);
    pending = null;
    await store.save(key, text);
    onSaved(key, text);
  };

  return {
    write: (key, text) => {
      if (pending !== null && pending.key !== key) void flush();

      if (pending !== null) clearTimeout(pending.timer);
      pending = { key, text, timer: setTimeout(() => void flush(), delayMs) };
    },
    flush,
    clear: async (key) => {
      if (pending?.key === key) {
        clearTimeout(pending.timer);
        pending = null;
      }

      await store.save(key, "");
    },
  };
};
