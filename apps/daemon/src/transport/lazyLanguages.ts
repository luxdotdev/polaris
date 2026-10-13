import { LanguageRpcs, PredictionContextQuery } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import type { DefaultLanguageHostHandlers } from "../languages/composition/defaults.ts";
import { cacheDaemonBuild, lazyRpcLayer } from "./lazy.ts";

const implemented = LanguageRpcs.omit(
  "languages.availability.watch",
  "languages.edit.decide",
  "languages.operation.get",
  "languages.operation.recover"
).add(PredictionContextQuery);

/** One Host language service graph is loaded on first use and retained by the Daemon scope. */
export const lazyLanguageHandlers = Layer.fromBuild((memoMap, scope) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Layer.Services<typeof DefaultLanguageHostHandlers>>();

    const load = yield* cacheDaemonBuild(
      Effect.gen(function* () {
        const module = yield* Effect.promise(() => import("../languages/composition/defaults.ts"));
        const media = yield* Effect.promise(() => import("../languages/media/rpc.ts"));
        const services = yield* Effect.promise(() => import("../languages/media/index.ts"));

        return yield* Layer.buildWithMemoMap(
          Layer.mergeAll(
            module.DefaultLanguageHostHandlers,
            media.PreviewMediaRpc.pipe(Layer.provide(services.HostPreviewMedia.layer()))
          ),
          memoMap,
          scope
        ).pipe(Effect.provide(context), Effect.orDie);
      })
    );

    return yield* Layer.buildWithMemoMap(lazyRpcLayer(implemented, load), memoMap, scope);
  })
);
