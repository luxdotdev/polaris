import { CapabilityProbe } from "@polaris/client/prediction/probe";
import {
  PredictionCapability,
  PredictionCapabilityQuery,
  PredictionError,
} from "@polaris/protocol";
import { Effect, Layer, Schema } from "effect";
import { RpcGroup } from "effect/rpc";

/** Capability probing stays lazy; constructing the layer launches no processes or requests. */
export const PredictionCapabilityLive = Layer.suspend(() => {
  const probe = new CapabilityProbe();

  return RpcGroup.make(PredictionCapabilityQuery).toLayer({
    "prediction.capability": Effect.fn("prediction.capability")(function* (request) {
      const report = yield* Effect.tryPromise({
        try: () =>
          probe.get(
            (request?.endpoints ?? []).flatMap((url) => [
              { kind: "openai" as const, url, models: [] },
              { kind: "ollama" as const, url, models: [] },
            ])
          ),
        catch: () =>
          new PredictionError({ reason: "unavailable", message: "Machine capability unavailable" }),
      });

      return yield* Schema.decodeUnknownEffect(PredictionCapability)(report).pipe(
        Effect.mapError(
          () =>
            new PredictionError({
              reason: "invalid-response",
              message: "Invalid machine capability",
            })
        )
      );
    }),
  });
});
