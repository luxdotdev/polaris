import { Context, Effect, Layer, Scope } from "effect";
import type { ReviewerLive } from "../reviewer/index.ts";
import { followAutomatic } from "../reviewer/automatic.ts";
import { needsReviewerStartup, registerReviewerSessions } from "../reviewer/recovery.ts";
import { Reviewer } from "../reviewer/service.ts";
import { cacheDaemonBuild } from "./lazy.ts";

type ReviewerBase = Layer.Services<ReturnType<typeof ReviewerLive>>;

/**
 * The Reviewer, loaded on its first Risk Summary or request. Its sessions' identities and the
 * automatic runs are followed from start; a restart that left work running loads it at once.
 */
export const lazyReviewer = Layer.fromBuild((memoMap, scope) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<ReviewerBase>();

    const load = yield* cacheDaemonBuild(
      Effect.gen(function* () {
        const module = yield* Effect.promise(() => import("../reviewer/index.ts"));

        const built = yield* Layer.buildWithMemoMap(
          module.ReviewerLive({ automatic: false }),
          memoMap,
          scope
        ).pipe(Effect.provide(context), Effect.orDie);

        return Context.get(built, Reviewer);
      })
    );

    yield* registerReviewerSessions;

    if (yield* needsReviewerStartup) yield* load;

    yield* followAutomatic((request) =>
      Effect.flatMap(load, (reviewer) => reviewer.runAutomatic(request))
    ).pipe(Effect.provideService(Scope.Scope, scope));

    return Context.make(
      Reviewer,
      Reviewer.of({
        run: (request) => Effect.flatMap(load, (reviewer) => reviewer.run(request)),
        runAutomatic: (request) =>
          Effect.flatMap(load, (reviewer) => reviewer.runAutomatic(request)),
        runWalkthrough: (...args) =>
          Effect.flatMap(load, (reviewer) => reviewer.runWalkthrough(...args)),
        stopWalkthrough: (summaryId) =>
          Effect.flatMap(load, (reviewer) => reviewer.stopWalkthrough(summaryId)),
        ask: (...args) => Effect.flatMap(load, (reviewer) => reviewer.ask(...args)),
        settings: (workspaceId) =>
          Effect.flatMap(load, (reviewer) => reviewer.settings(workspaceId)),
        setSettings: (settings) =>
          Effect.flatMap(load, (reviewer) => reviewer.setSettings(settings)),
      })
    );
  })
);
