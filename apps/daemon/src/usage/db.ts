/**
 * The Usage index's own SQLite file (`~/.polaris/usage.sqlite`): a cache over
 * the Harness logs, never the event store. Deleting it only costs a rebuild,
 * so a schema change bumps `SCHEMA_VERSION` and starts over.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

/** Bump when the schema or what a row means changes; the next open rebuilds. */
export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- One row per log file: how far it has been read and the parser's state there.
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  harness TEXT NOT NULL,
  offset INTEGER NOT NULL,
  size INTEGER NOT NULL,
  ino INTEGER NOT NULL,
  state TEXT
);

-- One row per counted response, after dedup. ts and hour are epoch ms (UTC).
CREATE TABLE usage (
  id INTEGER PRIMARY KEY,
  harness TEXT NOT NULL,
  native TEXT NOT NULL,
  ts INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  model TEXT NOT NULL,
  input INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  output INTEGER NOT NULL,
  reasoning INTEGER NOT NULL,
  -- The part of cache_write cached for an hour (Claude).
  cache_write_1h INTEGER NOT NULL DEFAULT 0,
  -- The request's whole prompt (input, cached or not): what long-context pricing looks at.
  context INTEGER NOT NULL DEFAULT 0,
  cost REAL,
  -- Codex: the cross-file dedup key. Claude keys live in claude_keys.
  dedupe TEXT UNIQUE,
  -- Claude: what its dedup rules compare.
  msg TEXT,
  req TEXT,
  sidechain INTEGER NOT NULL DEFAULT 0,
  fast INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX usage_hour ON usage (hour);
CREATE INDEX usage_native ON usage (harness, native);
CREATE INDEX usage_msg ON usage (msg) WHERE msg IS NOT NULL;

CREATE TABLE claude_keys (key TEXT PRIMARY KEY, entry INTEGER NOT NULL) WITHOUT ROWID;
-- A response copied into another Claude session, so that session's sidechain replays find it.
CREATE TABLE claude_alias (
  msg TEXT NOT NULL,
  session TEXT NOT NULL,
  entry INTEGER NOT NULL,
  PRIMARY KEY (msg, session, entry)
) WITHOUT ROWID;

-- Every Codex usage event per file before fork filtering: a forked child's replayed prefix.
CREATE TABLE codex_stream (
  file TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER,
  usage TEXT NOT NULL,
  PRIMARY KEY (file, seq)
) WITHOUT ROWID;
CREATE TABLE codex_threads (thread TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY (thread, file)) WITHOUT ROWID;

-- Harness session ids (a session's cursors) to Agent Sessions.
CREATE TABLE session_map (
  harness TEXT NOT NULL,
  native TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (harness, native)
) WITHOUT ROWID;

-- The last value of each Plan Limit window, so it outlives a Daemon restart.
CREATE TABLE plan_limits (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
`;

const version = (db: Database): number | null => {
  try {
    const row = db
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema'")
      .get();

    return row === null ? null : Number(row.value);
  } catch {
    return null;
  }
};

export type UsageDb = Database;

/** Opens the cache, recreating it when it is from another schema version or unreadable. */
export const openUsageDb = (path: string): Database => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  let db = new Database(path, { create: true, strict: true });

  if (version(db) !== SCHEMA_VERSION && path !== ":memory:" && existsSync(path)) {
    db.close();

    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
    db = new Database(path, { create: true, strict: true });
  }

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  // The worker writes passes while the Daemon writes Plan Limits: wait out the other's transaction.
  db.run("PRAGMA busy_timeout = 5000");
  // Checkpoint the WAL in small steps: one after 4 MB of writes stalls a pass tens of ms.
  db.run("PRAGMA wal_autocheckpoint = 64");

  if (version(db) === null) {
    db.transaction(() => {
      db.run(SCHEMA);
      db.run("INSERT INTO meta (key, value) VALUES ('schema', ?)", [String(SCHEMA_VERSION)]);
    })();
  }

  return db;
};
