/**
 * The store's side of continuity (ENG-458, ADR 0082): read positions and
 * composer drafts in SQL only (`session_reads`, `session_drafts`), outside the
 * event log and the read model. Each write says whether it changed anything.
 */
import { ComposerDraft, ReadPosition, SessionId, TurnId } from "@polaris/protocol";
import { Effect } from "effect";
import type { SqlClient } from "effect/sql";
import { storeError } from "./errors.ts";

interface ReadRow {
  readonly session_id: string;
  readonly turn_id: string;
  readonly turn_index: number;
  readonly at: string;
}

interface DraftRow {
  readonly session_id: string;
  readonly text: string;
  readonly revision: number;
  readonly at: string;
}

const toRead = (row: ReadRow) =>
  new ReadPosition({
    sessionId: SessionId.make(row.session_id),
    turnId: TurnId.make(row.turn_id),
    turnIndex: row.turn_index,
    at: row.at,
  });

const toDraft = (row: DraftRow) =>
  new ComposerDraft({
    sessionId: SessionId.make(row.session_id),
    text: row.text,
    revision: row.revision,
    at: row.at,
  });

/** What a write left in the store, and whether it changed it. */
export interface Written<A> {
  readonly value: A;
  readonly changed: boolean;
}

export interface ContinuityStore {
  readonly reads: Effect.Effect<ReadonlyArray<ReadPosition>>;
  /** Non-empty drafts only. */
  readonly drafts: Effect.Effect<ReadonlyArray<ComposerDraft>>;
  /** Null when the session has no such Turn. */
  readonly markRead: (options: {
    readonly sessionId: SessionId;
    readonly turnId: TurnId;
    readonly at: string;
  }) => Effect.Effect<Written<ReadPosition> | null>;
  readonly saveDraft: (options: {
    readonly sessionId: SessionId;
    readonly text: string;
    readonly at: string;
  }) => Effect.Effect<Written<ComposerDraft>>;
}

export const continuityStore = (sql: SqlClient.SqlClient): ContinuityStore => {
  const readOf = (sessionId: SessionId) =>
    sql<ReadRow>`SELECT * FROM session_reads WHERE session_id = ${sessionId}`;

  const draftOf = (sessionId: SessionId) =>
    sql<DraftRow>`SELECT * FROM session_drafts WHERE session_id = ${sessionId}`;

  return {
    reads: sql<ReadRow>`SELECT * FROM session_reads`.pipe(
      Effect.map((rows) => rows.map(toRead)),
      Effect.mapError(storeError("read read positions")),
      Effect.orDie
    ),
    drafts: sql<DraftRow>`SELECT * FROM session_drafts WHERE text != ''`.pipe(
      Effect.map((rows) => rows.map(toDraft)),
      Effect.mapError(storeError("read drafts")),
      Effect.orDie
    ),
    markRead: ({ sessionId, turnId, at }) =>
      Effect.gen(function* () {
        const turns = yield* sql<{ turn_index: number }>`
          SELECT turn_index FROM turns WHERE id = ${turnId} AND session_id = ${sessionId}`;

        const turn = turns[0];

        if (turn === undefined) return null;

        // Only a later Turn moves the position; RETURNING is empty when it didn't.
        const moved = yield* sql<ReadRow>`
          INSERT INTO session_reads (session_id, turn_id, turn_index, at)
          VALUES (${sessionId}, ${turnId}, ${turn.turn_index}, ${at})
          ON CONFLICT (session_id) DO UPDATE SET
            turn_id = excluded.turn_id, turn_index = excluded.turn_index, at = excluded.at
          WHERE excluded.turn_index > session_reads.turn_index
          RETURNING *`;

        if (moved[0] !== undefined) return { value: toRead(moved[0]), changed: true };
        const current = yield* readOf(sessionId);

        return current[0] === undefined ? null : { value: toRead(current[0]), changed: false };
      }).pipe(Effect.mapError(storeError("mark a Turn read")), Effect.orDie),
    saveDraft: ({ sessionId, text, at }) =>
      Effect.gen(function* () {
        // The same text again keeps its revision, so an echo doesn't count as a change.
        const saved = yield* sql<DraftRow>`
          INSERT INTO session_drafts (session_id, text, revision, at)
          VALUES (${sessionId}, ${text}, 1, ${at})
          ON CONFLICT (session_id) DO UPDATE SET
            text = excluded.text, revision = session_drafts.revision + 1, at = excluded.at
          WHERE excluded.text != session_drafts.text
          RETURNING *`;

        if (saved[0] !== undefined) return { value: toDraft(saved[0]), changed: true };
        const current = yield* draftOf(sessionId);

        return current[0] === undefined
          ? { value: new ComposerDraft({ sessionId, text, revision: 0, at }), changed: false }
          : { value: toDraft(current[0]), changed: false };
      }).pipe(Effect.mapError(storeError("save a draft")), Effect.orDie),
  };
};
