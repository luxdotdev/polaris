import type { HostId } from "@polaris/protocol";
import { Effect, Option, Predicate } from "effect";
import { decideSession } from "../engine/session.ts";
import { EventStore } from "../store/EventStore.ts";
import { decideConstellationJournal } from "./journal.ts";
import { ConstellationOwner, type ConstellationRuntimeService } from "./runtime.ts";
import { ConstellationSessionEffects, type RecoveryCandidate } from "./delivery/inputs.ts";
import { commitJournal, journalContext } from "./delivery/journal.ts";
import { ConstellationDelivery } from "./delivery/index.ts";
import { startedTurn } from "./delivery/turns.ts";

export const RECOVERY_PROMPT = "The Daemon restarted; continue your Task";

/** Test/startup helper for a runtime whose resume completes acquisition; asynchronous resumes use recoverAttempt in their hook. */
export const recoverWorkingAttempts = Effect.fn("Constellation.recoverWorkingAttempts")(function* (
  runtime: ConstellationRuntimeService,
  candidates: ReadonlyArray<RecoveryCandidate>,
  resumeRemote: Effect.Effect<void> = Effect.void
) {
  yield* runtime.resumeWorking();
  yield* resumeRemote;

  for (const candidate of candidates) yield* recoverAttempt(candidate);
});

/** Invoke from the working-attempt resume hook after its slot and lease have been acquired. */
export const recoverAttempt = Effect.fn("Constellation.recoverAttempt")(function* (
  candidate: RecoveryCandidate
) {
  const store = yield* EventStore;
  const hostId = yield* ConstellationOwner;
  const effects = yield* ConstellationSessionEffects;

  const commit = yield* store.commit({
    commandId: null,
    decide: (model) => {
      const graph = [...model.constellations.values()].find(
        (r) =>
          r.graph.hostId === hostId &&
          r.graph.state !== "completed" &&
          r.graph.state !== "archived" &&
          r.graph.leadSessionId !== candidate.sessionId &&
          r.graph.attempts.some((a) => a.sessionId === candidate.sessionId && a.state === "working")
      );

      const record = model.sessions.get(candidate.sessionId);

      const attempt = graph?.graph.attempts.findLast(
        (a) => a.sessionId === candidate.sessionId && a.state === "working"
      );

      if (
        graph === undefined ||
        record === undefined ||
        attempt === undefined ||
        attempt.hostId !== hostId ||
        graph.stale.has(attempt.id) ||
        record.pending.size !== 0
      )
        return Effect.succeed([]);
      const proof = graph.interruptions.get(attempt.id);

      if (
        proof === undefined ||
        !proof.eligible ||
        proof.interruptionId !== candidate.interruptionId ||
        record.turns.at(-1)?.id !== proof.turnId ||
        record.turns.at(-1)?.endedAt !== proof.at
      )
        return Effect.succeed([]);
      const turnEvents = decideSession(record, { type: "turn.continue" }).events;
      const turn = startedTurn(turnEvents);

      if (turn === undefined) return Effect.succeed([]);

      const decision = decideConstellationJournal(
        graph,
        {
          type: "recoveryContinued",
          attemptId: attempt.id,
          turnId: turn.id,
          interruptionId: candidate.interruptionId,
          turnEvents,
        },
        journalContext(graph, new Date().toISOString())
      );

      // A consumed allowance leaves the Session Needs You; there is no second automatic Continue.
      return Effect.succeed(decision.rejection === null ? decision.events : []);
    },
  });

  if (Predicate.isTagged(commit, "Committed")) {
    const turn = startedTurn(commit.envelopes.map((e) => e.event));

    if (turn !== undefined) yield* effects.runTurn(turn, RECOVERY_PROMPT);
  }
});

/** The Client relays existing Host Connection State observations; this never settles an Attempt. */
export const observeWorkerHost = Effect.fn("Constellation.observeWorkerHost")(function* (
  hostId: HostId,
  offline: boolean
) {
  const store = yield* EventStore;
  const owner = yield* ConstellationOwner;

  for (const record of (yield* store.model).constellations.values()) {
    if (record.graph.hostId !== owner) continue;

    for (const attempt of record.graph.attempts)
      if (attempt.hostId === hostId)
        yield* commitJournal(record.graph.id, {
          type: "connection",
          attemptId: attempt.id,
          offline,
        });
  }

  if (!offline) {
    const delivery = yield* Effect.serviceOption(ConstellationDelivery);

    if (Option.isSome(delivery)) yield* delivery.value.flush();
  }
});
