import { NotificationItem, type ConstellationId, type TurnId } from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { decideSession } from "../../engine/session.ts";
import { serialInput } from "./boundary.ts";
import { EventStore } from "../../store/EventStore.ts";
import { GraphDecision } from "../decision.ts";
import { decideConstellationJournal } from "../journal.ts";
import { ConstellationOwner } from "../runtime.ts";
import { ConstellationSessionEffects } from "./inputs.ts";
import { journalContext } from "./journal.ts";
import { digestPrompt } from "./format.ts";
import { pendingInputs, type PendingInput } from "./messages.ts";
import { newTurn, startedTurn, takesDelivery } from "./turns.ts";
import { unblocksAttempt } from "../blocked.ts";

const deliverInput = Effect.fn("Constellation.deliverLocalInput")(function* (
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

      const blocked = graph.graph.attempts.findLast(
        (a) => a.sessionId === input.sessionId && a.state === "blocked"
      );

      if (
        blocked !== undefined &&
        (record.turns.some((t) => t.status === "working") ||
          !unblocksAttempt(graph, blocked, input.id))
      )
        return Effect.succeed([]);
      const turn = newTurn(record.session, input.text, new Date().toISOString());
      const working = record.turns.some((t) => t.status === "working");

      const proof = blocked === undefined ? undefined : graph.interruptions.get(blocked.id);

      const recoveredBlock =
        blocked !== undefined &&
        proof?.eligible === true &&
        record.pending.size === 0 &&
        record.session.state === "needs-you" &&
        record.turns.at(-1)?.id === proof.turnId &&
        record.turns.at(-1)?.endedAt === proof.at;

      if (!working && !takesDelivery(record, turn) && !recoveredBlock) return Effect.succeed([]);

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

const digest = Effect.fn("Constellation.deliverDigest")(function* (id: ConstellationId) {
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

const nudge = Effect.fn("Constellation.nudgeSilentWorker")(function* (
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
        [...graph.questions.values()].some(
          (q) => q.attemptId === attempt.id && q.answer === null && q.question.blocking
        ) ||
        graph.graph.state === "archived" ||
        graph.graph.state === "completed"
      )
        return Effect.succeed([]);

      if (attempt.nudgedAt !== null) {
        const stopped = [...graph.notifications.values()].some(
          (n) =>
            Predicate.isTagged(n.item, "Stopped") &&
            n.item.attemptId === attempt.id &&
            n.queuedAt >= (record.turns.at(-1)?.startedAt ?? "")
        );

        if (stopped) return Effect.succeed([]);
        const d = new GraphDecision(graph, journalContext(graph, new Date().toISOString()));
        d.notify(
          NotificationItem.cases.Stopped.make({ taskId: attempt.taskId, attemptId: attempt.id })
        );

        return Effect.succeed(d.events);
      }

      const prompt = `Your Attempt isn't claimed: claim it, ask for a decision or answer, or call block with the Tasks and reason you are waiting on. Continue ${attempt.taskId} if work remains.`;
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

export const deliverLocalInput = (id: ConstellationId, input: PendingInput) =>
  serialInput(input.sessionId, deliverInput(id, input));

export const deliverDigest = (id: ConstellationId) =>
  Effect.gen(function* () {
    const store = yield* EventStore;
    const sessionId = (yield* store.model).constellations.get(id)?.graph.leadSessionId;

    if (sessionId !== undefined) yield* serialInput(sessionId, digest(id));
  });

export const nudgeSilentWorker = (
  id: ConstellationId,
  sessionId: PendingInput["sessionId"],
  endedTurnId: TurnId
) => serialInput(sessionId, nudge(id, sessionId, endedTurnId));
