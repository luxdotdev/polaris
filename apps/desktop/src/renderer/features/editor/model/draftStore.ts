/**
 * Where unsaved edits are kept: small ones whole in `localStorage`, big ones
 * (past `INLINE_MAX`) as a stub there with the text in IndexedDB, so a 3 MB
 * edit survives a restart too (QCHECK). Both stores are injected.
 */
import type { FileVersion } from "./buffer.ts";
import {
  type Draft,
  draftKey,
  dropDraft,
  type KeyValue,
  MAX_SPILLED_CHARS,
  readDraft,
  writeDraft,
} from "./drafts.ts";

/** A text store that takes big values: IndexedDB in the app, a map in tests. */
export interface SpillStore {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, text: string) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
}

/** Past this many characters a draft's text goes to the spill store. */
export const INLINE_MAX = 500_000;

export interface DraftInput {
  readonly hostKey: string;
  readonly path: string;
  readonly text: string;
  readonly base: FileVersion | null;
}

export interface DraftStore {
  /** Whether a draft is kept, without reading its text. */
  readonly has: (hostKey: string, path: string) => boolean;
  readonly read: (hostKey: string, path: string) => Promise<Draft | null>;
  /** False when it couldn't be kept (too big, storage full). */
  readonly write: (draft: DraftInput) => boolean;
  readonly drop: (hostKey: string, path: string) => void;
}

const quietly = (promise: Promise<unknown>) => void promise.catch(() => undefined);

export const createDraftStore = (kv: KeyValue | null, spill: SpillStore | null): DraftStore => {
  const key = (hostKey: string, path: string) => draftKey(hostKey, path);

  return {
    has: (hostKey, path) => kv !== null && readDraft(kv, hostKey, path) !== null,
    read: async (hostKey, path) => {
      const stub = kv === null ? null : readDraft(kv, hostKey, path);

      if (stub === null || stub.spilled !== true) return stub;
      const text = (await spill?.get(key(hostKey, path)).catch(() => null)) ?? null;

      return text === null ? null : { ...stub, text, spilled: false };
    },
    write: (draft) => {
      if (kv === null) return false;
      const big = draft.text.length > INLINE_MAX && spill !== null;

      if (!big && writeDraft(kv, draft)) {
        quietly(spill?.delete(key(draft.hostKey, draft.path)) ?? Promise.resolve());

        return true;
      }

      // Too big for localStorage, or its budget is full: the text goes to the spill store.
      const stub = spill !== null && draft.text.length <= MAX_SPILLED_CHARS;

      if (stub && writeDraft(kv, { ...draft, text: "", spilled: true })) {
        quietly(spill.put(key(draft.hostKey, draft.path), draft.text));

        return true;
      }

      // Not kept: an older draft must not come back in its place.
      dropDraft(kv, draft.hostKey, draft.path);

      return false;
    },
    drop: (hostKey, path) => {
      if (kv !== null) dropDraft(kv, hostKey, path);
      quietly(spill?.delete(key(hostKey, path)) ?? Promise.resolve());
    },
  };
};

/** A spill store in memory, for tests and previews. */
export const memorySpill = (): SpillStore & { readonly size: () => number } => {
  const map = new Map<string, string>();

  return {
    get: (k) => Promise.resolve(map.get(k) ?? null),
    put: (k, text) => {
      map.set(k, text);

      return Promise.resolve();
    },
    delete: (k) => {
      map.delete(k);

      return Promise.resolve();
    },
    size: () => map.size,
  };
};
