import type { EditPredictor } from "@polaris/predict";
import { PredictionError, type PredictionEndpoint } from "@polaris/protocol";
import { Effect, Layer, Stream } from "effect";
import type { Rpc } from "effect/rpc";
import { ServerRpcs } from "../transport/rpcs.ts";
import { lacksUserAccess } from "../userAccess/index.ts";
import { PredictionManagedLive } from "./managed/rpc.ts";
import { ManagedServer } from "./managed/server.ts";
import { ManagedModelServer } from "./managed/service.ts";

const stopped = () =>
  new PredictionError({
    reason: "unavailable",
    message: "The model server is stopped; a Desktop App this Host has enrolled starts it",
  });

/**
 * A request to the managed endpoint starts its server first (ADR 0049); any other passes through.
 * A caller without user access only uses a server that is serving, and never keeps it awake.
 */
const ensureManaged = Effect.fn("prediction.ensureManaged")(function* (
  endpoint: PredictionEndpoint,
  client: Rpc.ServerClient
) {
  const managed = yield* ManagedModelServer;

  if (!managed.ownsUrl(endpoint.url)) return;

  if (lacksUserAccess(client.annotations)) {
    if (!managed.isServing()) return yield* stopped();

    return;
  }

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
const completionHandlers = ServerRpcs.toLayerHandler("prediction.complete", (request, { client }) =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* ensureManaged(request.endpoint, client);
      const module = yield* Effect.promise(() => import("./complete.ts"));

      return module.complete(request);
    })
  )
);

/** The loader is a boundary for tests; construction does not import or contact a predictor. */
export const editPredictionHandlers = (load: () => Promise<EditPredictor>) =>
  ServerRpcs.toLayerHandler("prediction.edit", (request, { client }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const controller = new AbortController();
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
        yield* ensureManaged(request.endpoint, client);
        const predictor = yield* Effect.promise(load);

        return predictor.predict(request, { signal: controller.signal });
      })
    ).pipe(Stream.scoped)
  );

/** `prediction.complete` and `prediction.edit`; requires `ManagedModelServer`. */
export const predictionRequestHandlers = Layer.mergeAll(
  completionHandlers,
  editPredictionHandlers(async () => (await import("./edit.ts")).predictor)
);

export const PredictionRpcsLive = Layer.mergeAll(
  predictionRequestHandlers,
  PredictionManagedLive
).pipe(Layer.provide(ManagedModelServer.layer));

/** A test-only managed server that owns no endpoint, so every request passes through. */
export const managedServerForTests = (defaultDir: string) =>
  Layer.succeed(ManagedModelServer, new ManagedServer({ defaultDir }));
