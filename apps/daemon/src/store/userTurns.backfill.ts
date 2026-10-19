/**
 * Migration `0005_user_turns`: folds the event log's Turns as `model.ts` does since
 * `session.user-turns`, and writes the derived fields into the `turns` and `sessions` rows.
 */
import { type CurrentUserTurn, TurnId } from "@polaris/protocol";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { replyPreview } from "./replyPreview.ts";
import { userTurnAfter } from "./userTurns.ts";

interface TurnRow {
  readonly kind: "TurnStarted" | "TurnEnded" | "TurnItemCompleted";
  readonly session_id: string;
  readonly turn_id: string;
  /** `object` when the Turn has a trigger; `null` or SQL null without. */
  readonly trigger_type: string | null;
  readonly started_at: string | null;
  readonly text: string | null;
}

interface Derived {
  readonly number: number;
  preview: string | null;
  working: boolean;
}

interface SessionFold {
  current: CurrentUserTurn | null;
  lastReply: string | null;
  readonly turns: Map<string, Derived>;
}

const started = (session: SessionFold, row: TurnRow) => {
  const known = session.turns.get(row.turn_id);

  if (known !== undefined) {
    known.working = true;

    return;
  }

  const id = TurnId.make(row.turn_id);
  const harnessStarted = row.trigger_type === "object";
  const startedAt = row.started_at ?? "";
  session.current = userTurnAfter(session.current, { id, startedAt, harnessStarted });
  session.turns.set(row.turn_id, { number: session.current.number, preview: null, working: true });
};

const step = (session: SessionFold, row: TurnRow) => {
  const turn = session.turns.get(row.turn_id);

  if (row.kind === "TurnStarted") started(session, row);
  else if (row.kind === "TurnEnded" && turn !== undefined) {
    turn.working = false;
    session.lastReply = turn.preview;
  } else if (turn?.working === true && row.text !== null)
    turn.preview = replyPreview(row.text) ?? turn.preview;
};

/** Each session's user Turns and reply previews, folded from the log in order. */
export const foldUserTurns = (rows: ReadonlyArray<TurnRow>): ReadonlyMap<string, SessionFold> => {
  const sessions = new Map<string, SessionFold>();

  for (const row of rows) {
    let session = sessions.get(row.session_id);

    if (session === undefined) {
      session = { current: null, lastReply: null, turns: new Map() };
      sessions.set(row.session_id, session);
    }

    step(session, row);
  }

  return sessions;
};

export const backfillUserTurns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql<TurnRow>`
    SELECT event_type AS kind,
      coalesce(json_extract(payload, '$.turn.sessionId'), session_id) AS session_id,
      coalesce(json_extract(payload, '$.turn.id'), json_extract(payload, '$.turnId')) AS turn_id,
      json_type(payload, '$.turn.trigger') AS trigger_type,
      json_extract(payload, '$.turn.startedAt') AS started_at,
      json_extract(payload, '$.item.text') AS text
    FROM events
    WHERE event_type IN ('TurnStarted', 'TurnEnded')
      OR (event_type = 'TurnItemCompleted'
        AND json_extract(payload, '$.item._tag') = 'AssistantMessage'
        AND json_extract(payload, '$.subagentId') IS NULL)
    ORDER BY sequence`;

  for (const [sessionId, session] of foldUserTurns(rows)) {
    for (const [turnId, turn] of session.turns)
      yield* sql`UPDATE turns SET data = json_set(data,
        '$.userTurnNumber', ${turn.number}, '$.replyPreview', ${turn.preview})
        WHERE id = ${turnId}`;

    yield* sql`UPDATE sessions SET data = json_set(data,
      '$.currentUserTurn', json(${JSON.stringify(session.current)}),
      '$.lastReplyPreview', ${session.lastReply})
      WHERE id = ${sessionId}`;
  }
});
