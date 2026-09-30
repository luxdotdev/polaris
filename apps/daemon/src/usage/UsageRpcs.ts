/** Handlers for `usage.query` and `usage.watch` (capability `usage`). */
import { QueryUsage, WatchUsage } from "@polaris/protocol";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { UsageIndex } from "./UsageIndex.ts";

export class UsageRpcs extends RpcGroup.make(QueryUsage, WatchUsage) {}

/** Requires `UsageIndex`. */
export const UsageRpcsLive = UsageRpcs.toLayer(
  Effect.gen(function* () {
    const index = yield* UsageIndex;

    return {
      "usage.query": (query) => index.query(query),
      "usage.watch": () => index.changes,
    };
  })
);
