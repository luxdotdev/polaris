import { CapabilityProbe } from "@polaris/client/prediction/probe";
import {
  PredictionCapability,
  PredictionCapabilityQuery,
  PredictionError,
} from "@polaris/protocol";
import { Effect, Layer, Schema } from "effect";
import { RpcGroup } from "effect/rpc";
import { ManagedModelServer } from "./managed/service.ts";

/** Capability probing stays lazy; constructing the layer launches no processes or requests. */
export const PredictionCapabilityLive = Layer.suspend(() => {
  const probe = new CapabilityProbe();

  return RpcGroup.make(PredictionCapabilityQuery).toLayer({
    "prediction.capability": Effect.fn("prediction.capability")(function* (request) {
      const managed = yield* ManagedModelServer;

      const report = yield* Effect.tryPromise({
        try: async () => {
          // The managed endpoint is listed even while stopped: a request starts it (ADR 0048).
          await managed.status(request?.modelsDir ?? null, request?.model ?? null);
          const own = managed.endpoint();

          const probed = await probe.get(
            (request?.endpoints ?? []).flatMap((url) => [
              { kind: "openai" as const, url, models: [] },
              { kind: "ollama" as const, url, models: [] },
            ])
          );

          return own === null
            ? probed
            : {
                ...probed,
                endpoints: [
                  own,
                  ...probed.endpoints.filter((endpoint) => endpoint.url !== own.url),
                ],
              };
        },
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
}).pipe(Layer.provide(ManagedModelServer.layer));
