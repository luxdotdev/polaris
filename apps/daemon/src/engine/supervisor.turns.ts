import { DomainEvent, type SessionId, TurnId } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import type { ServiceError } from "../services.ts";
import { LiveItem } from "../store/EventStore.ts";
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
          ((DomainEvent.guards.TurnEnded(item.envelope.event) &&
            item.envelope.event.turn.id === turnId) ||
            (DomainEvent.guards.SessionStateChanged(item.envelope.event) &&
              (item.envelope.event.state === "archived" || !rt.live.has(sessionId)))),
      });
      // Subscribe before checking the folded status, so an end between them cannot be missed.

      const record = (yield* rt.store.model).sessions.get(sessionId);

      if (
        record?.turns.find((turn) => turn.id === turnId)?.status === "working" &&
        record.session.state !== "archived" &&
        rt.live.has(sessionId)
      ) {
        const wake = yield* events.pipe(Stream.take(1), Stream.runCollect);

        if (wake.length === 0) return "the Session was deleted or its event stream closed";
      }

      const current = (yield* rt.store.model).sessions.get(sessionId);

      if (current === undefined) return "the Session was deleted";

      if (current.session.state === "archived") return "the session is Archived";

      if (!rt.live.has(sessionId)) return "the Harness exited";

      return null;
    })
  );

const restartUserTurn = (rt: EngineRuntime["Service"], input: TurnToRun, refusal: string | null) =>
  Effect.gen(function* () {
    const id = TurnId.make(`turn_${crypto.randomUUID()}`);
    const at = yield* rt.now;

    const result = yield* rt.signalWith(input.sessionId, (record) => ({
      type: "turn.deliver",
      turn: userTurn(
        record?.session ?? {
          id: input.sessionId,
          turnCount: 0,
          model: null,
          effort: null,
          serviceTier: null,
        },
        { id, prompt: input.prompt, attachments: input.attachments, at }
      ),
      targetTurnId: input.turnId,
      refusal,
    }));

    const waiting = result.effects.find(
      (effect) => effect !== "scheduleIdleStop" && effect !== "stopHarness"
    );

    const started =
      "envelopes" in result &&
      result.envelopes.some((e) => DomainEvent.guards.TurnStarted(e.event));

    return {
      waiting: waiting?.turnId ?? null,
      started: started ? { ...input, turnId: id, steerExisting: false } : null,
    };
  });

export const refuseUserTurn = (rt: EngineRuntime["Service"], input: TurnToRun, reason: string) =>
  restartUserTurn(rt, input, reason).pipe(Effect.asVoid);

/** Taking the last item and retiring its lane must not yield between the two operations. */
export const takeDeferredTurn = (
  queues: Map<SessionId, Array<TurnToRun>>,
  sessionId: SessionId,
  queue: Array<TurnToRun>
) => {
  const next = queue.shift();

  if (next === undefined && queues.get(sessionId) === queue) queues.delete(sessionId);

  return next;
};

/** Deferred prompts have their own arrival-order lane; only preparation and delivery use the reactor lock. */
export const deferredUserTurns = (
  rt: EngineRuntime["Service"],
  deliver: (input: TurnToRun) => Effect.Effect<boolean, ServiceError>
) => {
  const queues = new Map<SessionId, Array<TurnToRun>>();

  const process = (input: TurnToRun, refusal: string | null) =>
    Effect.gen(function* () {
      if (refusal === null) {
        const delivered = yield* withWorkerAdmission(
          rt.store,
          input.sessionId,
          rt.serially(input.sessionId)(deliver(input))
        );

        if (delivered === undefined) {
          const reason = "its worker admission was retired";
          yield* rt.serially(input.sessionId)(refuseUserTurn(rt, input, reason));

          return reason;
        }

        if (delivered) return yield* waitForTurnEnd(rt, input.sessionId, input.turnId);
      }

      while (true) {
        const next = yield* withWorkerAdmission(
          rt.store,
          input.sessionId,
          rt.serially(input.sessionId)(
            restartUserTurn(rt, input, refusal).pipe(
              Effect.tap((result) =>
                result.started === null ? Effect.void : deliver(result.started)
              )
            )
          )
        );

        if (next === undefined) {
          const reason = refusal ?? "its worker admission was retired";
          yield* rt.serially(input.sessionId)(refuseUserTurn(rt, input, reason));

          return reason;
        }

        if (next.waiting === null) return refusal;
        refusal = yield* waitForTurnEnd(rt, input.sessionId, next.waiting);
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
        let refusal: string | null = null;

        while ((next = takeDeferredTurn(queues, input.sessionId, queue)) !== undefined)
          refusal = yield* process(next, refusal).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("delivering a queued prompt failed", cause).pipe(Effect.as(refusal))
            )
          );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (queues.get(input.sessionId) === queue) queues.delete(input.sessionId);
          })
        ),
        Effect.forkIn(rt.engineScope)
      );
    });
};
