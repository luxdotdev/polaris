/**
 * The store's side of Origins (ADR 0111): line fingerprints of what each Turn wrote, in SQL only
 * (`origin_fingerprints`, `origin_turns`). A projection of the log and the checkpoints that can
 * be rebuilt: removing a Workspace purges its rows with the session tables (`projection.ts`).
 */
import { SessionId, TurnId, type WorkspaceId } from "@polaris/protocol";
import { Effect } from "effect";
import type { SqlClient } from "effect/sql";
import { type FingerprintMatch, matchKey } from "../origins/resolve.ts";
import { storeError } from "./errors.ts";

/** Rows per INSERT and per transaction, so a large Turn never holds the write lock for long. */
const CHUNK = 500;

/** `origin_state` key set once the upgrade's backfill has run. */
const BACKFILL_DONE = "backfill-done";

export interface Fingerprint {
  readonly lineHash: string;
  readonly path: string;
}

export interface IndexedTurn {
  readonly workspaceId: WorkspaceId;
  readonly repoKey: string;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  /** When the Turn wrote these lines (its after-checkpoint), epoch ms. */
  readonly at: number;
  readonly fingerprints: ReadonlyArray<Fingerprint>;
}

export interface OriginStore {
  /** The Turns already fingerprinted of these sessions, as `session/turn` keys. */
  readonly indexedTurns: (
    sessionIds: ReadonlyArray<SessionId>
  ) => Effect.Effect<ReadonlySet<string>>;
  /** Writes a Turn's fingerprints, then marks it indexed; writing it again changes nothing. */
  readonly record: (turn: IndexedTurn) => Effect.Effect<void>;
  /** Every fingerprint of `repoKey` with one of these hashes in that path, keyed by `matchKey`. */
  readonly match: (
    repoKey: string,
    lines: ReadonlyArray<Fingerprint>
  ) => Effect.Effect<ReadonlyMap<string, ReadonlyArray<FingerprintMatch>>>;
  /** Deletes a session's fingerprints (an Agent Session deleted). */
  readonly dropSession: (sessionId: SessionId) => Effect.Effect<void>;
  readonly backfillDone: Effect.Effect<boolean>;
  readonly markBackfillDone: Effect.Effect<void>;
}

interface MatchRow {
  readonly line_hash: string;
  readonly path: string;
  readonly session_id: string;
  readonly turn_id: string;
  readonly at: number;
}

export const turnKey = (sessionId: string, turnId: string) => `${sessionId}/${turnId}`;

const chunks = <A>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, at) =>
    items.slice(at * CHUNK, (at + 1) * CHUNK)
  );

export const originStore = (sql: SqlClient.SqlClient): OriginStore => {
  const insertChunk = (turn: IndexedTurn, rows: ReadonlyArray<Fingerprint>) =>
    sql`INSERT OR IGNORE INTO origin_fingerprints ${sql.insert(
      rows.map((row) => ({
        repo_key: turn.repoKey,
        line_hash: row.lineHash,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        path: row.path,
        workspace_id: turn.workspaceId,
        at: turn.at,
      }))
    )}`;

  const markIndexed = (turn: IndexedTurn) =>
    sql`INSERT OR REPLACE INTO origin_turns ${sql.insert({
      session_id: turn.sessionId,
      turn_id: turn.turnId,
      workspace_id: turn.workspaceId,
      fingerprints: turn.fingerprints.length,
    })}`;

  return {
    indexedTurns: (sessionIds) =>
      (sessionIds.length === 0
        ? Effect.succeed<ReadonlyArray<{ session_id: string; turn_id: string }>>([])
        : sql<{ session_id: string; turn_id: string }>`
            SELECT session_id, turn_id FROM origin_turns WHERE session_id IN ${sql.in(sessionIds)}`
      ).pipe(
        Effect.map((rows) => new Set(rows.map((row) => turnKey(row.session_id, row.turn_id)))),
        Effect.mapError(storeError("read indexed Turns")),
        Effect.orDie
      ),
    record: (turn) =>
      Effect.gen(function* () {
        for (const rows of chunks(turn.fingerprints))
          yield* sql.withTransaction(insertChunk(turn, rows));
        yield* markIndexed(turn);
      }).pipe(Effect.mapError(storeError("record fingerprints")), Effect.orDie),
    match: (repoKey, lines) =>
      Effect.gen(function* () {
        const found = new Map<string, Array<FingerprintMatch>>();
        const wanted = new Set(lines.map((l) => matchKey(l.lineHash, l.path)));
        const hashes = [...new Set(lines.map((l) => l.lineHash))];
        const paths = [...new Set(lines.map((l) => l.path))];

        // Hash and path both in the index; a pair outside `wanted` is dropped below.
        for (const some of chunks(hashes))
          for (const inPaths of chunks(paths)) {
            const rows = yield* sql<MatchRow>`
            SELECT DISTINCT line_hash, path, session_id, turn_id, at FROM origin_fingerprints
            WHERE repo_key = ${repoKey} AND line_hash IN ${sql.in(some)}
              AND path IN ${sql.in(inPaths)}`;

            for (const row of rows) {
              const key = matchKey(row.line_hash, row.path);

              if (!wanted.has(key)) continue;
              const list = found.get(key) ?? [];
              list.push({
                sessionId: SessionId.make(row.session_id),
                turnId: TurnId.make(row.turn_id),
                at: row.at,
              });
              found.set(key, list);
            }
          }

        return found;
      }).pipe(Effect.mapError(storeError("match fingerprints")), Effect.orDie),
    dropSession: (sessionId) =>
      sql
        .withTransaction(
          Effect.all([
            sql`DELETE FROM origin_fingerprints WHERE session_id = ${sessionId}`,
            sql`DELETE FROM origin_turns WHERE session_id = ${sessionId}`,
          ])
        )
        .pipe(Effect.asVoid, Effect.mapError(storeError("drop fingerprints")), Effect.orDie),
    backfillDone: sql<{
      value: string;
    }>`SELECT value FROM origin_state WHERE key = ${BACKFILL_DONE}`.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.mapError(storeError("read the backfill state")),
      Effect.orDie
    ),
    markBackfillDone:
      sql`INSERT OR REPLACE INTO origin_state (key, value) VALUES (${BACKFILL_DONE}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`.pipe(
        Effect.asVoid,
        Effect.mapError(storeError("mark the backfill done")),
        Effect.orDie
      ),
  };
};
