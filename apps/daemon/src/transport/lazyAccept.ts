import { CommitAccepted, DraftAccept, GetAcceptPlan, PushAccepted } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { RpcGroup } from "effect/rpc";
import type { AcceptRpcsLive } from "../accept/AcceptRpcs.ts";
import { cacheDaemonBuild, lazyRpcLayer } from "./lazy.ts";

const accept = RpcGroup.make(GetAcceptPlan, DraftAccept, CommitAccepted, PushAccepted);

/** The accept handlers (`session.accept`), loaded on the first accept request. */
export const lazyAcceptHandlers = Layer.fromBuild((memoMap, scope) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Layer.Services<typeof AcceptRpcsLive>>();

    const load = yield* cacheDaemonBuild(
      Effect.gen(function* () {
        const module = yield* Effect.promise(() => import("../accept/AcceptRpcs.ts"));

        return yield* Layer.buildWithMemoMap(module.AcceptRpcsLive, memoMap, scope).pipe(
          Effect.provide(context),
          Effect.orDie
        );
      })
    );

    return yield* Layer.buildWithMemoMap(lazyRpcLayer(accept, load), memoMap, scope);
  })
);
