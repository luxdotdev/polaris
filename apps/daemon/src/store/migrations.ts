/**
 * Schema of the Daemon's SQLite database (`~/.polaris/state.sqlite`).
 *
 * `events` is the source of truth: a global, gapless `sequence` per Host.
 * Every other table is a projection of it (or a command receipt), written in
 * the same transaction as the events that change it.
 *
 * Projection rows keep the encoded domain object as JSON next to the columns
 * we filter on, so the read model loads without re-deriving it from events.
 */
import { SqliteMigrator } from "@effect/sql-sqlite-bun"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

const init = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE events (
      sequence INTEGER PRIMARY KEY,
      stream_kind TEXT NOT NULL CHECK (stream_kind IN ('host', 'session')),
      session_id TEXT,
      event_type TEXT NOT NULL,
      command_id TEXT,
      occurred_at TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `
  yield* sql`CREATE INDEX events_session ON events (session_id, sequence)`
  yield* sql`
    CREATE TABLE command_receipts (
      command_id TEXT PRIMARY KEY,
      sequence INTEGER,
      rejection TEXT,
      recorded_at TEXT NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE worktrees (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      state TEXT NOT NULL,
      title_locked INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `
  yield* sql`CREATE INDEX turns_session ON turns (session_id, turn_index)`
  yield* sql`
    CREATE TABLE turn_items (
      sequence INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `
  yield* sql`CREATE INDEX turn_items_turn ON turn_items (turn_id, sequence)`
  yield* sql`
    CREATE TABLE pending_approvals (
      request_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `
})

export const migrations = SqliteMigrator.fromRecord({
  "0001_event_store": init,
})

export const MigrationsLayer = SqliteMigrator.layer({ loader: migrations })
