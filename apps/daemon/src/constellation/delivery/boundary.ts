import { CommandId, type AttemptId, type SessionId } from "@polaris/protocol";
import { Effect } from "effect";
import { withSessionBoundary } from "../../engine/sessionBoundary.ts";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationSessionEffects } from "./inputs.ts";

export const serialInput = <A, E, R>(sessionId: SessionId, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const store = yield* EventStore;
    const effects = yield* ConstellationSessionEffects;

    return yield* effects.serialInput === undefined
      ? withSessionBoundary(store, sessionId, effect)
      : effects.serialInput(sessionId, effect);
  });

/** Attempt-addressed steers cannot precede its brief or a terminal startup receipt. */
export const startupReceipted = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  attemptId: AttemptId
) {
  return (
    (yield* store.hasCommandReceipt(CommandId.make(`${attemptId}:start`)).pipe(Effect.orDie)) ||
    (yield* store
      .hasCommandReceipt(CommandId.make(`${attemptId}:startup-failed`))
      .pipe(Effect.orDie))
  );
});
