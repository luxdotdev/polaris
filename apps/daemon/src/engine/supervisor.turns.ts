import { DomainEvent, TurnId } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import type { ServiceError } from "../services.ts";
import { LiveItem } from "../store/EventStore.ts";
import { workingTurn } from "../store/model.ts";
import { userTurn } from "./session.turns.ts";
import type { EngineRuntime } from "./runtime.ts";
import type { TurnToRun } from "./supervisor.ts";

export const waitForTurnEnd = (
  rt: EngineRuntime["Service"],
  input: TurnToRun,
  events: Stream.Stream<LiveItem>
) =>
  Effect.gen(function* () {
    const record = (yield* rt.store.model).sessions.get(input.sessionId);

    if (record?.turns.find((turn) => turn.id === input.turnId)?.status !== "working") return;
    yield* events.pipe(
      Stream.filter(
        (item) =>
          LiveItem.$is("Event")(item) &&
          DomainEvent.guards.TurnEnded(item.envelope.event) &&
          item.envelope.event.turn.id === input.turnId
      ),
      Stream.take(1),
      Stream.runDrain
    );
  });

export const restartUserTurn = (
  rt: EngineRuntime["Service"],
  input: TurnToRun,
  run: (input: TurnToRun) => Effect.Effect<void, ServiceError>
) =>
  Effect.gen(function* () {
    const id = TurnId.make(`turn_${crypto.randomUUID()}`);
    const at = yield* rt.now;

    const result = yield* rt.signalWith(input.sessionId, (record) => ({
      type: "turn.send",
      turn: userTurn(record.session, {
        id,
        prompt: input.prompt,
        attachments: input.attachments,
        at,
      }),
    }));

    const record = "model" in result ? result.model.sessions.get(input.sessionId) : undefined;
    const next = record === undefined ? undefined : workingTurn(record);

    if (next === undefined) return;
    yield* run({ ...input, turnId: next.id, steerExisting: next.id !== id });
  });
