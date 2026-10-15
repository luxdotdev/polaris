/**
 * `prediction.managed` and `prediction.managed.watch` (ADR 0049): the status of the model
 * server this Daemon runs, the actions on it, and a stream of its changes while watched.
 */
import {
  PredictionError,
  type ManagedServerAction,
  type ManagedServerRequest,
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

const act = (server: ManagedServer, request: ManagedServerRequest, action: ManagedServerAction) =>
  Match.value(action).pipe(
    Match.when("setup", () => server.setup(request.modelsDir, request.model)),
    Match.when("cancel", () => Promise.resolve(server.cancel())),
    // A start from a Client-side request also resets the idle clock (ADR 0049).
    Match.when("start", () => server.start().then(() => server.touch())),
    Match.when("stop", () => Promise.resolve(server.stop())),
    Match.when("remove", () => server.remove(request.modelsDir, request.model)),
    Match.exhaustive
  );

const managedQuery = ServerRpcs.toLayerHandler("prediction.managed", (request) =>
  Effect.gen(function* () {
    const server = yield* ManagedModelServer;
    const launched = request.action === "start" && !server.isServing();

    if (request.action === "setup") {
      // The download runs on; the caller watches progress rather than holding the RPC open.
      void server.setup(request.modelsDir, request.model).catch(() => {});
    } else if (request.action !== null) {
      const action = request.action;
      yield* Effect.tryPromise({ try: () => act(server, request, action), catch: asError });
    }

    const status = yield* Effect.tryPromise({
      try: () => server.status(request.modelsDir, request.model),
      catch: asError,
    });

    return { ...status, launched };
  })
);

const managedWatch = ServerRpcs.toLayerHandler("prediction.managed.watch", (request) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const server = yield* ManagedModelServer;

      return Stream.callback<ManagedServerStatus, PredictionError>(
        Effect.fn("prediction.managed.watch")(function* (queue) {
          const first = yield* Effect.tryPromise({
            try: () => server.status(request.modelsDir, request.model),
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
