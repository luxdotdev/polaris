import { DomainEvent, type SessionId, TurnId, TurnItem } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import type { ServiceError } from "../services.ts";
import { LiveItem } from "../store/EventStore.ts";
import { workingTurn } from "../store/model.ts";
import { decideSession } from "./session.ts";
import { userTurn } from "./session.turns.ts";
import { withWorkerAdmission } from "../resources/workerAdmission.ts";
import type { EngineRuntime } from "./runtime.ts";
import type { TurnToRun } from "./supervisor.ts";

export const waitForTurnEnd = (
  rt: EngineRuntime["Service"],
  sessionId: SessionId,
  turnId: TurnId
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* rt.store.subscribe({
        sessionId,
        filter: (item) =>
          LiveItem.$is("Event")(item) &&
          DomainEvent.guards.TurnEnded(item.envelope.event) &&
          item.envelope.event.turn.id === turnId,
      });
      // Subscribe before checking the folded status, so an end between them cannot be missed.

      const record = (yield* rt.store.model).sessions.get(sessionId);

      if (record?.turns.find((turn) => turn.id === turnId)?.status !== "working") return;
      yield* events.pipe(Stream.take(1), Stream.runDrain);
    })
  );

const restartUserTurn = (rt: EngineRuntime["Service"], input: TurnToRun) =>
  Effect.gen(function* () {
    const id = TurnId.make(`turn_${crypto.randomUUID()}`);
    const at = yield* rt.now;
    let waiting: TurnId | null = null;
    let started = false;

    yield* rt.recordFor(input.sessionId, (record) => {
      const working = workingTurn(record);

      if (working !== undefined) {
        waiting = working.id;

        return [];
      }

      const decision = decideSession(record, {
        type: "turn.send",
        turn: userTurn(record.session, {
          id,
          prompt: input.prompt,
          attachments: input.attachments,
          at,
        }),
      });

      started = decision.events.some(DomainEvent.guards.TurnStarted);

      if (started) return decision.events;

      return [
        DomainEvent.cases.TurnItemCompleted.make({
          sessionId: input.sessionId,
          turnId: input.turnId,
          subagentId: null,
          item: TurnItem.cases.UserMessage.make({ id: `refused:${id}`, text: input.prompt }),
        }),
        DomainEvent.cases.TurnItemCompleted.make({
          sessionId: input.sessionId,
          turnId: input.turnId,
          subagentId: null,
          item: TurnItem.cases.Error.make({
            id: `refusal:${id}`,
            message: `Could not deliver the queued prompt: ${decision.rejection ?? "the session cannot take a Turn"}`,
          }),
        }),
      ];
    });

    return { waiting, started: started ? { ...input, turnId: id, steerExisting: false } : null };
  });

const refuseAdmission = (rt: EngineRuntime["Service"], input: TurnToRun) => {
  const id = crypto.randomUUID();

  return rt.recordFor(input.sessionId, () => [
    DomainEvent.cases.TurnItemCompleted.make({
      sessionId: input.sessionId,
      turnId: input.turnId,
      subagentId: null,
      item: TurnItem.cases.UserMessage.make({ id: `refused:${id}`, text: input.prompt }),
    }),
    DomainEvent.cases.TurnItemCompleted.make({
      sessionId: input.sessionId,
      turnId: input.turnId,
      subagentId: null,
      item: TurnItem.cases.Error.make({
        id: `refusal:${id}`,
        message: "Could not deliver the queued prompt: its worker admission was retired",
      }),
    }),
  ]);
};

/** Deferred prompts have their own arrival-order lane; only preparation and delivery use the reactor lock. */
export const deferredUserTurns = (
  rt: EngineRuntime["Service"],
  deliver: (input: TurnToRun) => Effect.Effect<boolean, ServiceError>
) => {
  const queues = new Map<SessionId, Array<TurnToRun>>();

  const process = (input: TurnToRun) =>
    Effect.gen(function* () {
      const delivered = yield* withWorkerAdmission(
        rt.store,
        input.sessionId,
        rt.serially(input.sessionId)(deliver(input))
      );

      if (delivered === undefined) return yield* refuseAdmission(rt, input);

      if (delivered) {
        yield* waitForTurnEnd(rt, input.sessionId, input.turnId);

        return;
      }

      while (true) {
        const next = yield* withWorkerAdmission(
          rt.store,
          input.sessionId,
          rt.serially(input.sessionId)(
            restartUserTurn(rt, input).pipe(
              Effect.tap((result) =>
                result.started === null ? Effect.void : deliver(result.started)
              )
            )
          )
        );

        if (next === undefined) return yield* refuseAdmission(rt, input);

        if (next.waiting === null) return;
        yield* waitForTurnEnd(rt, input.sessionId, next.waiting);
      }
    });

  return (input: TurnToRun) =>
    Effect.gen(function* () {
      const existing = queues.get(input.sessionId);

      if (existing !== undefined) {
        existing.push(input);

        return;
      }

      const queue = [input];
      queues.set(input.sessionId, queue);
      yield* Effect.gen(function* () {
        let next: TurnToRun | undefined;

        while ((next = queue.shift()) !== undefined)
          yield* process(next).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("delivering a queued prompt failed", cause)
            )
          );
      }).pipe(
        Effect.ensuring(Effect.sync(() => queues.delete(input.sessionId))),
        Effect.forkIn(rt.engineScope)
      );
    });
};
