import type { ConstellationId, SessionId, TurnId } from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { decideConstellationJournal } from "../journal.ts";
import { ConstellationOwner } from "../runtime.ts";
import { journalContext } from "./journal.ts";

/** Only a failed current local worker settles mechanically; an Offline Host retains its Attempt. */
export const settleFailedWorker = Effect.fn("Constellation.settleFailedWorker")(function* (
  id: ConstellationId,
  sessionId: SessionId,
  turnId: TurnId
) {
  const store = yield* EventStore;
  const owner = yield* ConstellationOwner;
  yield* store.commit({
    commandId: null,
    decide: (model) => {
      const graph = model.constellations.get(id);
      const record = model.sessions.get(sessionId);

      const attempt = graph?.graph.attempts.findLast(
        (a) => a.sessionId === sessionId && a.state === "working"
      );

      if (
        graph === undefined ||
        record === undefined ||
        attempt === undefined ||
        graph.graph.hostId !== owner ||
        attempt.hostId !== owner ||
        (record.turns.at(-1)?.startedAt ?? "") < attempt.startedAt ||
        graph.graph.leadSessionId === sessionId ||
        graph.stale.has(attempt.id) ||
        record.session.state !== "failed" ||
        record.turns.at(-1)?.id !== turnId
      )
        return Effect.succeed([]);

      const decision = decideConstellationJournal(
        graph,
        {
          type: "settle",
          attemptId: attempt.id,
          outcome: "failed",
          reason: record.session.lastError ?? "The worker Harness failed",
        },
        journalContext(graph, new Date().toISOString())
      );

      return decision.rejection === null
        ? Effect.succeed(decision.events)
        : Effect.fail(decision.rejection);
    },
  });
});
