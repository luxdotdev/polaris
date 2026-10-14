/** The Usage index's service tag, apart from its implementation so the Daemon can load that on first use. */
import type {
  HarnessKind,
  PlanLimit,
  SessionId,
  UsageReport,
  UsageStreamItem,
} from "@polaris/protocol";
import { Context, type Effect, type Stream } from "effect";
import type { UsageHarness } from "./indexer.ts";
import type { UsageResponseQuery, UsageResponses } from "./responses.ts";

export interface UsageQuery {
  readonly from: string;
  readonly to: string;
  readonly harness: HarnessKind | null;
  readonly sessionId: SessionId | null;
}

export class UsageIndex extends Context.Service<
  UsageIndex,
  {
    /** Brings the index up to date with the logs (only what was appended since the last pass). */
    readonly refresh: (harnesses?: ReadonlyArray<UsageHarness>) => Effect.Effect<void>;
    /** Answers from the index, once a pass it starts has finished or ~250 ms have passed. */
    readonly query: (query: UsageQuery) => Effect.Effect<UsageReport>;
    readonly responses: (query: UsageResponseQuery) => Effect.Effect<UsageResponses>;
    /** Every known Plan Limit, then Usage and Plan Limit changes; watches the logs while subscribed. */
    readonly changes: Stream.Stream<UsageStreamItem>;
    /** The latest value of every Plan Limit window known (the Reviewer's near-limit note). */
    readonly planLimits: Effect.Effect<ReadonlyArray<PlanLimit>>;
  }
>()("polaris/daemon/usage/UsageIndex") {}
