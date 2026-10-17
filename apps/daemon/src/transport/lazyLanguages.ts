import {
  LanguageError,
  LanguageRpcs,
  PredictionContextQuery,
  PredictionError,
} from "@polaris/protocol";
import { Context, Effect, Layer, Stream } from "effect";
import { RpcSchema, type Rpc } from "effect/rpc";
import { currentLanguagePlatform } from "../languages/composition/environment.ts";
import type { DefaultLanguageHostHandlers } from "../languages/composition/defaults.ts";
import { cacheDaemonBuild, lazyRpcLayer } from "./lazy.ts";

const implemented = LanguageRpcs.omit(
  "languages.availability.watch",
  "languages.edit.decide",
  "languages.operation.get",
  "languages.operation.recover"
).add(PredictionContextQuery);

const UNAVAILABLE = "Language services are unavailable on this Host platform";

type Implemented = typeof implemented extends { readonly requests: ReadonlyMap<string, infer R> }
  ? R
  : never;

/**
 * Where no language artifact runs (Windows until 0.3.0, ENG-296), each RPC fails
 * cleanly. Building the real graph there dies, and effect/rpc ends a connection on a defect.
 */
const unavailableLanguageHandlers = Layer.succeedContext(
  Context.makeUnsafe<Rpc.ToHandler<Implemented>>(
    new Map(
      [...implemented.requests.values()].map((rpc) => {
        const error =
          rpc._tag === PredictionContextQuery._tag
            ? new PredictionError({ reason: "unavailable", message: UNAVAILABLE })
            : new LanguageError({
                reason: "unsupported-platform",
                message: UNAVAILABLE,
                retryable: false,
              });

        return [
          rpc.key,
          {
            tag: rpc._tag,
            context: Context.empty(),
            handler: () =>
              RpcSchema.isStreamSchema(rpc.successSchema) ? Stream.fail(error) : Effect.fail(error),
          },
        ];
      })
    )
  )
);

/** Whether this Host can run language services; the Daemon advertises them only then. */
export const languagesAvailable = (): boolean => currentLanguagePlatform() !== null;

/** One Host language service graph is loaded on first use and retained by the Daemon scope. */
export const lazyLanguageHandlers = Layer.fromBuild((memoMap, scope) =>
  Effect.gen(function* () {
    if (!languagesAvailable())
      return yield* Layer.buildWithMemoMap(unavailableLanguageHandlers, memoMap, scope);
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
