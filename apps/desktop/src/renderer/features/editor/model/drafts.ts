/**
 * Unsaved edits kept on this Mac per Host and path (spec §3), so they survive
 * a restart; the open tabs per Workspace persist beside them. Storage is
 * injected: `localStorage` in the app, a map in tests.
 */
import { Option, Schema } from "effect";
import type { FileVersion } from "./buffer.ts";
import type { TabSet } from "./tabs.ts";

export interface KeyValue {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
  readonly key: (index: number) => string | null;
  readonly length: number;
}

const DRAFT_PREFIX = "polaris.editor.draft.v1:";

const TABS_KEY = "polaris.editor.tabs.v1";

/** A draft kept whole in `localStorage` stops here; bigger ones spill (`draftStore.ts`). */
export const MAX_DRAFT_CHARS = 2_000_000;

/** Past this even the spill store doesn't keep it: the edit stays in memory only. */
export const MAX_SPILLED_CHARS = 64_000_000;

/** All inline drafts together stay under this; past it a draft spills or, failing that, says so. */
export const MAX_DRAFTS_CHARS = 4_000_000;

const Version = Schema.Struct({ mtimeMs: Schema.Number, size: Schema.Number, hash: Schema.String });

const Draft = Schema.Struct({
  hostKey: Schema.String,
  path: Schema.String,
  text: Schema.String,
  /** The disk version the edits were made on; null for a file not yet on disk. */
  base: Schema.NullOr(Version),
  savedAt: Schema.Number,
  /** The text is in the spill store (IndexedDB), not here (`draftStore.ts`). */
  spilled: Schema.optionalKey(Schema.Boolean),
});

export type Draft = typeof Draft.Type;

const decodeDraft = Schema.decodeUnknownOption(Schema.fromJsonString(Draft));

const Tabs = Schema.Record(
  Schema.String,
  Schema.Struct({
    tabs: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        preview: Schema.Boolean,
        view: Schema.optionalKey(Schema.Literal("markdown")),
        locked: Schema.optionalKey(Schema.Boolean),
      })
    ),
    active: Schema.NullOr(Schema.String),
    activeView: Schema.optionalKey(Schema.Literal("markdown")),
  })
);

const decodeTabs = Schema.decodeUnknownOption(Schema.fromJsonString(Tabs), {
  onExcessProperty: "error",
});

export const fileKey = (hostKey: string, path: string) => `${hostKey}\u0000${path}`;

export const workspaceKey = (hostKey: string, workspaceId: string) =>
  `${hostKey}\u0000${workspaceId}`;

export const draftKey = (hostKey: string, path: string) => DRAFT_PREFIX + fileKey(hostKey, path);

const safely = <A>(run: () => A, fallback: A): A => {
  try {
    return run();
  } catch {
    return fallback;
  }
};

export const readDraft = (kv: KeyValue, hostKey: string, path: string): Draft | null =>
  safely(() => {
    const raw = kv.getItem(draftKey(hostKey, path));

    return raw === null ? null : Option.getOrNull(decodeDraft(raw));
  }, null);

export const dropDraft = (kv: KeyValue, hostKey: string, path: string) =>
  safely(() => kv.removeItem(draftKey(hostKey, path)), undefined);

const allDrafts = (kv: KeyValue): ReadonlyArray<{ key: string; draft: Draft }> =>
  safely(() => {
    const found: Array<{ key: string; draft: Draft }> = [];

    for (let i = 0; i < kv.length; i++) {
      const key = kv.key(i);
      const raw = key?.startsWith(DRAFT_PREFIX) === true ? kv.getItem(key) : null;
      const draft = raw === null ? null : Option.getOrNull(decodeDraft(raw));

      if (key !== null && draft !== null) found.push({ key, draft });
    }

    return found;
  }, []);

/** Keeps a draft within the inline budget; false when it doesn't fit (never evicts another). */
export const writeDraft = (
  kv: KeyValue,
  draft: Omit<Draft, "savedAt">,
  now = Date.now()
): boolean => {
  if (draft.text.length > MAX_DRAFT_CHARS) return false;
  const key = draftKey(draft.hostKey, draft.path);
  const others = allDrafts(kv).reduce((n, d) => (d.key === key ? n : n + d.draft.text.length), 0);

  if (others + draft.text.length > MAX_DRAFTS_CHARS) return false;

  return safely(() => {
    kv.setItem(key, JSON.stringify({ ...draft, savedAt: now }));

    return true;
  }, false);
};

/** Every kept draft: what the quit prompt and a restart restore. */
export const listDrafts = (kv: KeyValue): ReadonlyArray<Draft> => allDrafts(kv).map((d) => d.draft);

export const readTabs = (kv: KeyValue): Readonly<Record<string, TabSet>> =>
  safely(() => {
    const raw = kv.getItem(TABS_KEY);

    return raw === null ? {} : Option.getOrElse(decodeTabs(raw), () => ({}));
  }, {});

export const writeTabs = (kv: KeyValue, tabs: Readonly<Record<string, TabSet>>) =>
  safely(() => kv.setItem(TABS_KEY, JSON.stringify(tabs)), undefined);

/** Whether a draft still applies to the disk as it is now. */
export const draftMatches = (draft: Draft, disk: FileVersion | null) =>
  draft.base === null
    ? disk === null
    : disk !== null && draft.base.hash === disk.hash && draft.base.size === disk.size;

/** An in-memory `KeyValue` for tests and previews. */
export const memoryKeyValue = (): KeyValue => {
  const map = new Map<string, string>();

  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
};
