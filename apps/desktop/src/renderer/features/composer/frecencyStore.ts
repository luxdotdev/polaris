/**
 * Where the `/` menu's frecency lives: this device's `localStorage`, one table
 * per Host, Workspace and Harness, so a Workspace's habits stay its own. Local
 * only and bounded (`MAX_SCOPES` tables of `MAX_ENTRIES`); unreadable storage
 * just means no frecency.
 */
import { Option, Schema } from "effect";
import { type FrecencyTable, recordPick } from "./model/frecency.ts";

const STORAGE_KEY = "polaris.composer.frecency.v1";

/** Tables kept; the least recently used goes first. */
export const MAX_SCOPES = 40;

const Entry = Schema.Struct({ count: Schema.Number, picks: Schema.Array(Schema.Number) });

const Stored = Schema.Record(
  Schema.String,
  Schema.Struct({ usedAt: Schema.Number, table: Schema.Record(Schema.String, Entry) })
);

type Stored = typeof Stored.Type;

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Stored));

export interface FrecencyScope {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly harness: string;
}

export const scopeKey = ({ hostKey, workspaceId, harness }: FrecencyScope) =>
  `${hostKey}\u0000${workspaceId}\u0000${harness}`;

// Parsed once: composers read it on every render, and only this window writes it.
let cached: Stored | null = null;

const read = (): Stored => {
  if (cached !== null) return cached;

  try {
    cached = Option.getOrElse(decode(localStorage.getItem(STORAGE_KEY) ?? "{}"), () => ({}));
  } catch {
    cached = {};
  }

  return cached;
};

const write = (stored: Stored) => {
  cached = stored;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Quota or a locked store: frecency lasts until the window closes.
  }
};

export const loadFrecency = (scope: FrecencyScope): FrecencyTable =>
  read()[scopeKey(scope)]?.table ?? {};

/** Keeps the newest `MAX_SCOPES` tables. */
export const boundScopes = (stored: Stored): Stored =>
  Object.fromEntries(
    Object.entries(stored)
      .sort(([, a], [, b]) => b.usedAt - a.usedAt)
      .slice(0, MAX_SCOPES)
  );

/** Records a pick of `key` in the scope's table, and returns the new table. */
export const recordFrecency = (scope: FrecencyScope, key: string, now = Date.now()) => {
  const stored = read();
  const id = scopeKey(scope);
  const table = recordPick(stored[id]?.table ?? {}, key, now);

  write(boundScopes({ ...stored, [id]: { usedAt: now, table } }));

  return table;
};
