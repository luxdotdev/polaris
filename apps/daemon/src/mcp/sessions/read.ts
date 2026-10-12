import type { SessionId } from "@polaris/protocol";
import { Effect } from "effect";
import type { EventStore } from "../../store/EventStore.ts";
import type { TranscriptOptions } from "./index.ts";
import { transcriptText } from "./transcript.ts";

/** Reads from SQL, so Turns older than the model's window come back too. */
export const readTranscript = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  sessionId: SessionId,
  options: TranscriptOptions
) {
  const model = yield* store.model;
  const session = model.sessions.get(sessionId)?.session;

  if (session === undefined) return null;

  // From Turn `since` (one-based) on: the `turns` Turns before index since - 1 + turns.
  const turns = yield* store.readTurns({
    sessionId,
    beforeIndex: options.since === null ? null : options.since - 1 + options.turns,
    limit: options.turns,
  });

  const items = yield* store.readTurnItems({
    turnIds: turns.map((turn) => turn.id),
    upTo: model.sequence,
  });

  return transcriptText(
    `${session.title} · ${session.harness} · ${session.state}`,
    turns
      .filter((turn) => options.since === null || turn.index >= options.since - 1)
      .map((turn) => ({ turn, items: items.get(turn.id) ?? [] }))
  );
});
