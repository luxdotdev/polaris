import { LanguageRpcs } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import type { DefaultLanguageHostHandlers } from "../languages/composition/defaults.ts";
import { lazyRpcLayer } from "./lazy.ts";

const implemented = LanguageRpcs.omit(
  "languages.availability.watch",
  "languages.format",
  "languages.edit.decide",
  "languages.operation.get",
  "languages.operation.recover",
  "languages.preview.media"
);

/** One Host language service graph is loaded on first use and retained by the Daemon scope. */
export const lazyLanguageHandlers = Layer.fromBuild((memoMap, scope) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Layer.Services<typeof DefaultLanguageHostHandlers>>();

    const load = yield* Effect.cached(
      Effect.gen(function* () {
        const module = yield* Effect.promise(() => import("../languages/composition/defaults.ts"));

        return yield* Layer.buildWithMemoMap(
          module.DefaultLanguageHostHandlers,
          memoMap,
          scope
        ).pipe(Effect.provide(context), Effect.orDie);
      }).pipe(Effect.uninterruptible)
    );

    return yield* Layer.buildWithMemoMap(lazyRpcLayer(implemented, load), memoMap, scope);
  })
);
