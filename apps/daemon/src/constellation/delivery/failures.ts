import type { AttemptId, ConstellationId, PlanLimit, SessionId, TurnId } from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { capacityResetsAt, classifyFailure } from "../failureKind.ts";
import { decideConstellationJournal } from "../journal.ts";
import { ConstellationOwner } from "../runtime.ts";
import { journalContext } from "./journal.ts";
import { attemptLease } from "./lease.ts";

/** Only a failed current local worker settles mechanically; an Offline Host retains its Attempt. */
export const settleFailedWorker = Effect.fn("Constellation.settleFailedWorker")(function* (
  id: ConstellationId,
  sessionId: SessionId,
  turnId: TurnId,
  limits: Effect.Effect<ReadonlyArray<PlanLimit>> = Effect.succeed([])
) {
  const store = yield* EventStore;
  const owner = yield* ConstellationOwner;
  // Read before the commit: the decision stays pure and the Usage index stays outside the lock.
  const known = yield* limits;
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

      const now = new Date().toISOString();
      const failureKind = classifyFailure(record.session.lastError);

      // Capacity is reported, never redispatched: the Lead decides when and where to retry.
      const decision = decideConstellationJournal(
        graph,
        {
          type: "settle",
          attemptId: attempt.id,
          outcome: "failed",
          reason: record.session.lastError ?? "The worker Harness failed",
          failureKind,
          resetsAt:
            failureKind === "capacity"
              ? capacityResetsAt(record.session.harness, known, now)
              : null,
        },
        journalContext(graph, now)
      );

      return decision.rejection === null
        ? Effect.succeed(decision.events)
        : Effect.fail(decision.rejection);
    },
  });
});

/** A lease that ran out settles its Attempt lost; the decision re-derives it from the fold. */
export const settleExpiredLease = Effect.fn("Constellation.settleExpiredLease")(function* (
  id: ConstellationId,
  attemptId: AttemptId,
  now: number
) {
  const store = yield* EventStore;
  const owner = yield* ConstellationOwner;
  yield* store.commit({
    commandId: null,
    decide: (model) => {
      const graph = model.constellations.get(id);
      const attempt = graph?.graph.attempts.find((a) => a.id === attemptId);

      const lease =
        graph === undefined || attempt === undefined
          ? null
          : attemptLease(graph, attempt, model.sessions, owner);

      if (graph === undefined || lease === null || lease.until > now) return Effect.succeed([]);

      const decision = decideConstellationJournal(
        graph,
        { type: "settle", attemptId, outcome: "lost", reason: lease.reason },
        journalContext(graph, new Date(now).toISOString())
      );

      return decision.rejection === null
        ? Effect.succeed(decision.events)
        : Effect.fail(decision.rejection);
    },
  });
});
