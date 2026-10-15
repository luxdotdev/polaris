/**
 * `prediction.managed` and `prediction.managed.watch` (ADR 0048): the status of the model
 * server this Daemon runs, the actions on it, and a stream of its changes while watched.
 */
import {
  PredictionError,
  type ManagedServerAction,
  type ManagedServerStatus,
} from "@polaris/protocol";
import { Effect, Layer, Match, Queue, Stream } from "effect";
import { ServerRpcs } from "../../transport/rpcs.ts";
import { ManagedModelServer } from "./service.ts";
import type { ManagedServer } from "./server.ts";

const asError = (cause: unknown) =>
  new PredictionError({
    reason: "unavailable",
    message: cause instanceof Error ? cause.message : String(cause),
  });

const act = (server: ManagedServer, action: ManagedServerAction, modelsDir: string | null) =>
  Match.value(action).pipe(
    Match.when("setup", () => server.setup(modelsDir)),
    Match.when("cancel", () => Promise.resolve(server.cancel())),
    Match.when("start", () => server.start()),
    Match.when("stop", () => Promise.resolve(server.stop())),
    Match.when("remove", () => server.remove(modelsDir)),
    Match.exhaustive
  );

const managedQuery = ServerRpcs.toLayerHandler("prediction.managed", (request) =>
  Effect.gen(function* () {
    const server = yield* ManagedModelServer;

    if (request.action === "setup") {
      // The download runs on; the caller watches progress rather than holding the RPC open.
      void server.setup(request.modelsDir).catch(() => {});
    } else if (request.action !== null) {
      yield* Effect.tryPromise({
        try: () => act(server, request.action ?? "stop", request.modelsDir),
        catch: asError,
      });
    }

    return yield* Effect.tryPromise({
      try: () => server.status(request.modelsDir),
      catch: asError,
    });
  })
);

const managedWatch = ServerRpcs.toLayerHandler("prediction.managed.watch", (request) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const server = yield* ManagedModelServer;

      return Stream.callback<ManagedServerStatus, PredictionError>(
        Effect.fn("prediction.managed.watch")(function* (queue) {
          const first = yield* Effect.tryPromise({
            try: () => server.status(request.modelsDir),
            catch: asError,
          });

          Queue.offerUnsafe(queue, first);
          const stop = server.watch((status) => Queue.offerUnsafe(queue, status));
          yield* Effect.addFinalizer(() => Effect.sync(stop));
        })
      );
    })
  )
);

export const PredictionManagedLive = Layer.merge(managedQuery, managedWatch);
