import type { EditPredictor } from "@polaris/predict";
import { PredictionError, type PredictionEndpoint } from "@polaris/protocol";
import { Effect, Layer, Stream } from "effect";
import { ServerRpcs } from "../transport/rpcs.ts";
import { PredictionManagedLive } from "./managed/rpc.ts";
import { ManagedServer } from "./managed/server.ts";
import { ManagedModelServer } from "./managed/service.ts";

/** A request to the managed endpoint starts its server first (ADR 0049); any other passes through. */
const ensureManaged = Effect.fn("prediction.ensureManaged")(function* (
  endpoint: PredictionEndpoint
) {
  const managed = yield* ManagedModelServer;

  if (!managed.ownsUrl(endpoint.url)) return;
  yield* Effect.tryPromise({
    try: () => managed.start(),
    catch: (cause) =>
      new PredictionError({
        reason: "unavailable",
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  managed.touch();
});

/** No predictor or endpoint work is loaded until the first completion request. */
const completionHandlers = ServerRpcs.toLayerHandler("prediction.complete", (request) =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* ensureManaged(request.endpoint);
      const module = yield* Effect.promise(() => import("./complete.ts"));

      return module.complete(request);
    })
  )
);

/** The loader is a boundary for tests; construction does not import or contact a predictor. */
export const editPredictionHandlers = (load: () => Promise<EditPredictor>) =>
  ServerRpcs.toLayerHandler("prediction.edit", (request) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const controller = new AbortController();
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
        yield* ensureManaged(request.endpoint);
        const predictor = yield* Effect.promise(load);

        return predictor.predict(request, { signal: controller.signal });
      })
    ).pipe(Stream.scoped)
  );

export const PredictionRpcsLive = Layer.mergeAll(
  completionHandlers,
  editPredictionHandlers(async () => (await import("./edit.ts")).predictor),
  PredictionManagedLive
).pipe(Layer.provide(ManagedModelServer.layer));

/** A test-only managed server that owns no endpoint, so every request passes through. */
export const managedServerForTests = (defaultDir: string) =>
  Layer.succeed(ManagedModelServer, new ManagedServer({ defaultDir }));
