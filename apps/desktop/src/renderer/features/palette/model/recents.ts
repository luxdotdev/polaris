/**
 * The palette's Recent: command ids newest first, kept on this Mac in local
 * storage. Storage may be missing or full; Recent then lives for the app session.
 */
import { Schema } from "effect";

export const RECENTS_KEY = "polaris.palette.recent.v1";

/** Kept beyond what Recent shows, so a command unavailable now keeps its place. */
export const RECENTS_KEPT = 20;

export interface RecentsStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

const Stored = Schema.fromJsonString(Schema.Array(Schema.String));

export const withRecent = (recent: ReadonlyArray<string>, id: string): ReadonlyArray<string> =>
  [id, ...recent.filter((r) => r !== id)].slice(0, RECENTS_KEPT);

export const loadRecents = (storage: RecentsStorage | null): ReadonlyArray<string> => {
  try {
    const raw = storage?.getItem(RECENTS_KEY) ?? null;

    return raw === null ? [] : Schema.decodeUnknownSync(Stored)(raw).slice(0, RECENTS_KEPT);
  } catch {
    return [];
  }
};

export const saveRecents = (storage: RecentsStorage | null, recent: ReadonlyArray<string>) => {
  try {
    storage?.setItem(RECENTS_KEY, Schema.encodeSync(Stored)(recent));
  } catch {
    // A full or blocked storage keeps Recent in memory only.
  }
};
