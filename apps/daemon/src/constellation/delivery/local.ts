import type { ConstellationId, TurnId } from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { decideSession } from "../../engine/session.ts";
import { EventStore } from "../../store/EventStore.ts";
import { decideConstellationJournal } from "../journal.ts";
import { ConstellationOwner } from "../runtime.ts";
import { ConstellationSessionEffects } from "./inputs.ts";
import { journalContext } from "./journal.ts";
import { digestPrompt } from "./format.ts";
import { pendingInputs, type PendingInput } from "./messages.ts";
import { newTurn, startedTurn, takesDelivery } from "./turns.ts";

export const deliverLocalInput = Effect.fn("Constellation.deliverLocalInput")(function* (
  id: ConstellationId,
  input: PendingInput
) {
  const store = yield* EventStore;
  const effects = yield* ConstellationSessionEffects;
  const owner = yield* ConstellationOwner;
  const canSteer = yield* effects.canSteer(input.sessionId);

  const result = yield* store.commit({
    commandId: null,
    decide: (model) => {
      const graph = model.constellations.get(id);
      const record = model.sessions.get(input.sessionId);

      if (
        graph === undefined ||
        record === undefined ||
        graph.graph.hostId !== owner ||
        graph.graph.state === "archived" ||
        !pendingInputs(graph).some((i) => i.id === input.id && i.sessionId === input.sessionId) ||
        (graph.graph.leadSessionId === input.sessionId &&
          (graph.graph.state === "paused" || graph.handoverRequest !== null))
      )
        return Effect.succeed([]);
      const turn = newTurn(record.session, input.text, new Date().toISOString());
      const working = record.turns.some((t) => t.status === "working");

      if (!working && !takesDelivery(record, turn)) return Effect.succeed([]);

      const session = decideSession(
        record,
        working ? { type: "turn.steer", canSteer } : { type: "turn.send", turn }
      );

      if (session.rejection !== null) return Effect.succeed([]);

      const decision = decideConstellationJournal(
        graph,
        {
          type: "inputDelivered",
          id: input.id,
          sessionId: input.sessionId,
          turnEvents: session.events,
        },
        journalContext(graph, turn.startedAt)
      );

      return decision.rejection === null
        ? Effect.succeed(decision.events)
        : Effect.fail(decision.rejection);
    },
  });

  if (!Predicate.isTagged(result, "Committed") || result.envelopes.length === 0) return;
  const turn = startedTurn(result.envelopes.map((e) => e.event));

  if (turn === undefined) yield* effects.steer(input.sessionId, input.text);
  else yield* effects.runTurn(turn, input.text);
});

export const deliverDigest = Effect.fn("Constellation.deliverDigest")(function* (
  id: ConstellationId
) {
  const store = yield* EventStore;
  const effects = yield* ConstellationSessionEffects;
  const owner = yield* ConstellationOwner;

  const result = yield* store.commit({
    commandId: null,
    decide: (model) => {
      const graph = model.constellations.get(id);

      if (
        graph === undefined ||
        graph.graph.hostId !== owner ||
        graph.graph.state !== "running" ||
        graph.handoverRequest !== null ||
        graph.graph.pendingNotifications.length === 0
      )
        return Effect.succeed([]);
      const record = model.sessions.get(graph.graph.leadSessionId);

      if (record === undefined) return Effect.succeed([]);
      const turn = newTurn(record.session, digestPrompt(graph), new Date().toISOString());

      if (!takesDelivery(record, turn)) return Effect.succeed([]);
      const session = decideSession(record, { type: "turn.send", turn });

      const decision = decideConstellationJournal(
        graph,
        {
          type: "notified",
          leadSessionId: turn.sessionId,
          turnId: turn.id,
          items: graph.graph.pendingNotifications.map((n) => n.id),
          turnEvents: session.events,
        },
        journalContext(graph, turn.startedAt)
      );

      return decision.rejection === null
        ? Effect.succeed(decision.events)
        : Effect.fail(decision.rejection);
    },
  });

  if (Predicate.isTagged(result, "Committed")) {
    const turn = startedTurn(result.envelopes.map((e) => e.event));

    if (turn !== undefined) yield* effects.runTurn(turn, turn.prompt);
  }
});

export const nudgeSilentWorker = Effect.fn("Constellation.nudgeSilentWorker")(function* (
  id: ConstellationId,
  sessionId: PendingInput["sessionId"],
  endedTurnId: TurnId
) {
  const store = yield* EventStore;
  const effects = yield* ConstellationSessionEffects;
  const owner = yield* ConstellationOwner;

  const result = yield* store.commit({
    commandId: null,
    decide: (model) => {
      const graph = model.constellations.get(id);
      const record = model.sessions.get(sessionId);

      const attempt = graph?.graph.attempts.findLast(
        (a) => a.sessionId === sessionId && a.state === "working"
      );

      if (
        graph === undefined ||
        graph.graph.hostId !== owner ||
        record === undefined ||
        record.turns.at(-1)?.id !== endedTurnId ||
        attempt === undefined ||
        (record.turns.at(-1)?.startedAt ?? "") < attempt.startedAt ||
        graph.graph.leadSessionId === sessionId ||
        graph.stale.has(attempt.id) ||
        attempt.nudgedAt !== null ||
        [...graph.questions.values()].some(
          (q) => q.attemptId === attempt.id && q.answer === null && q.question.blocking
        ) ||
        graph.graph.state === "archived" ||
        graph.graph.state === "completed"
      )
        return Effect.succeed([]);
      const prompt = `Your Turn ended without a Claim. Continue Task ${attempt.taskId}; call claim when finished, or ask if you need an answer.`;
      const turn = newTurn(record.session, prompt, new Date().toISOString());

      if (!takesDelivery(record, turn)) return Effect.succeed([]);

      const decision = decideConstellationJournal(
        graph,
        {
          type: "nudged",
          attemptId: attempt.id,
          turnId: turn.id,
          turnEvents: decideSession(record, { type: "turn.send", turn }).events,
        },
        journalContext(graph, turn.startedAt)
      );

      return decision.rejection === null
        ? Effect.succeed(decision.events)
        : Effect.fail(decision.rejection);
    },
  });

  if (Predicate.isTagged(result, "Committed")) {
    const turn = startedTurn(result.envelopes.map((e) => e.event));

    if (turn !== undefined) yield* effects.runTurn(turn, turn.prompt);
  }
});
