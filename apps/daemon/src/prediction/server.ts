import { PredictionError, PredictionServerQuery } from "@polaris/protocol";
import { Effect, Predicate, Schema } from "effect";
import { RpcGroup } from "effect/rpc";

const asPredictionError = (cause: unknown) =>
  Predicate.isTagged(cause, "PredictionError") && Schema.is(PredictionError)(cause)
    ? cause
    : new PredictionError({ reason: "endpoint-failed", message: "The model server didn't answer" });

/** The model server behind a Host endpoint; loaded only when the status card first asks. */
export const PredictionServerLive = RpcGroup.make(PredictionServerQuery).toLayer({
  "prediction.server": Effect.fn("prediction.server")(function* (request) {
    const module = yield* Effect.promise(() => import("@polaris/client/prediction/server"));

    return yield* Effect.tryPromise({
      try: () => module.runServerAction(request),
      catch: asPredictionError,
    });
  }),
});
