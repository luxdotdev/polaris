import { PredictionContextQuery, type HostId } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { RpcGroup } from "effect/rpc";
import { cacheDaemonBuild, lazyRpcLayer } from "../transport/lazy.ts";
import type { predictionContextHandlers } from "./context.ts";

type Services = Layer.Services<ReturnType<typeof predictionContextHandlers>>;

/** Even an active language graph defers the assembler until the first prediction request. */
export const lazyPredictionContextHandlers = (hostId: HostId) =>
  Layer.fromBuild((memoMap, scope) =>
    Effect.gen(function* () {
      const services = yield* Effect.context<Services>();

      const load = yield* cacheDaemonBuild(
        Effect.gen(function* () {
          const module = yield* Effect.promise(() => import("./context.ts"));

          return yield* Layer.buildWithMemoMap(
            module.predictionContextHandlers(hostId),
            memoMap,
            scope
          ).pipe(Effect.provide(services), Effect.orDie);
        })
      );

      return yield* Layer.buildWithMemoMap(
        lazyRpcLayer(RpcGroup.make(PredictionContextQuery), load),
        memoMap,
        scope
      );
    })
  );
