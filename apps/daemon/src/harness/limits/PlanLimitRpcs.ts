/**
 * `usage.watch` with Plan Limits, and `usage.query` answering "not indexed
 * yet" until the Usage index (ENG-205) replaces both with the full handlers.
 */
import { QueryUsage, UsageReport, UsageStreamItem, WatchUsage } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { RpcGroup } from "effect/rpc";
import { PlanLimits } from "./PlanLimits.ts";

export class PlanLimitRpcs extends RpcGroup.make(QueryUsage, WatchUsage) {}

/** Every known Plan Limit, then each change, as `usage.watch` items. */
export const planLimitItems = (planLimits: PlanLimits["Service"]) =>
  planLimits.changes.pipe(
    Stream.map((limit) => UsageStreamItem.cases.PlanLimitChanged.make({ limit }))
  );

/** Requires `PlanLimits`. */
export const PlanLimitRpcsLive = PlanLimitRpcs.toLayer(
  Effect.gen(function* () {
    const planLimits = yield* PlanLimits;

    return {
      "usage.query": () => Effect.succeed(new UsageReport({ buckets: [], indexedAt: null })),
      "usage.watch": () => planLimitItems(planLimits),
    };
  })
);
