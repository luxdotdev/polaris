import { Context, Effect, Layer, Stream } from "effect";
import { PlanLimitSink } from "../services.ts";
import { UsageIndex } from "../usage/service.ts";
import type { UsageSessions } from "../usage/sessions.ts";
import type { UsageIndexOptions } from "../usage/UsageIndex.ts";
import { cacheDaemonBuild } from "./lazy.ts";

/**
 * The Usage index and its Plan Limit sink, loaded on the first Usage request or reported Plan
 * Limit. Until then no Plan Limit is known, as in a loaded index that has not opened its store.
 */
export const lazyUsage = (options: UsageIndexOptions) =>
  Layer.fromBuild((memoMap, scope) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<UsageSessions>();
      let loaded: UsageIndex["Service"] | null = null;

      const load = yield* cacheDaemonBuild(
        Effect.gen(function* () {
          const module = yield* Effect.promise(() => import("../usage/UsageIndex.ts"));

          const built = yield* Layer.buildWithMemoMap(
            module.UsageIndexLive(options),
            memoMap,
            scope
          ).pipe(Effect.provide(context), Effect.orDie);

          loaded = Context.get(built, UsageIndex);

          return { index: loaded, sink: Context.get(built, PlanLimitSink) };
        })
      );

      return Context.make(
        UsageIndex,
        UsageIndex.of({
          refresh: (harnesses) => Effect.flatMap(load, ({ index }) => index.refresh(harnesses)),
          query: (query) => Effect.flatMap(load, ({ index }) => index.query(query)),
          responses: (query) => Effect.flatMap(load, ({ index }) => index.responses(query)),
          changes: Stream.unwrap(Effect.map(load, ({ index }) => index.changes)),
          planLimits: Effect.suspend(() =>
            loaded === null ? Effect.succeed([]) : loaded.planLimits
          ),
        })
      ).pipe(
        Context.add(
          PlanLimitSink,
          PlanLimitSink.of({
            report: (limit) => Effect.flatMap(load, ({ sink }) => sink.report(limit)),
          })
        )
      );
    })
  );
