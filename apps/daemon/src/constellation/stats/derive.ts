import {
  ConstellationStats,
  type Constellation,
  type EventEnvelope,
  Sequence,
  type SessionId,
} from "@polaris/protocol";
import type { UsageResponses } from "../../usage/responses.ts";
import { attributeUsage, completedAt, digestStats } from "./attribution.ts";
import { reviewStats } from "./review.ts";
import { leaseWaits, sumTimes, workerTimes } from "./timing.ts";

export interface StatsHistory {
  readonly graph: Constellation;
  readonly sequence: number;
  readonly events: ReadonlyArray<EventEnvelope>;
  readonly sessions: ReadonlyMap<SessionId, ReadonlyArray<EventEnvelope>>;
  readonly leases: ReadonlyArray<EventEnvelope>;
}

/** Derived on a view; open intervals close at asOf, never from an idle timer. */
export const deriveStats = (
  history: StatsHistory,
  usage: UsageResponses,
  asOf: number,
  cached?: Pick<ConstellationStats, "lead" | "review" | "usage">
): ConstellationStats => {
  const { graph, events } = history;
  const waits = leaseWaits(history.leases, asOf);

  const attempts = graph.attempts.map((attempt) => ({
    attemptId: attempt.id,
    taskId: attempt.taskId,
    sessionId: attempt.sessionId,
    times: workerTimes({
      attempt,
      graphEvents: events,
      sessionEvents: history.sessions.get(attempt.sessionId) ?? [],
      waits,
      now: asOf,
      local: attempt.hostId === graph.hostId,
    }),
  }));

  const coverage: ConstellationStats["coverage"][number][] = [
    {
      metric: "workers.staleMs",
      attemptId: null,
      reason:
        "Offline intervals are not recorded yet; L stale/fresh Constellation events will unlock this metric.",
    },
  ];

  for (const attempt of attempts) {
    if (attempt.times.waitingForSlotMs === null)
      coverage.push({
        metric: "workers.waitingForSlotMs",
        attemptId: attempt.attemptId,
        reason:
          "No local __workers queue/grant history for this Attempt; legacy or remote slot time is unknown.",
      });

    if (attempt.times.workingMs === null || attempt.times.waitingOnLeaseMs === null)
      coverage.push({
        metric: "workers",
        attemptId: attempt.attemptId,
        reason: "Worker Session and lease history is unavailable on this Host.",
      });
  }

  if (graph.attempts.some((a) => a.hostId !== graph.hostId))
    coverage.push({
      metric: "usage",
      attemptId: null,
      reason: "Usage is local to this Host; remote worker Usage must be joined by the Client.",
    });

  if (usage.indexing)
    coverage.push({
      metric: "usage",
      attemptId: null,
      reason: "The existing Usage index is still catching up; these are observed partial totals.",
    });
  const lead = cached?.lead ?? digestStats(events, history.sessions, usage.responses, asOf);

  if (lead.wakeups > 0 && lead.meanTokensPerDigest === null)
    coverage.push({
      metric: "lead.digests",
      attemptId: null,
      reason: "A digest Turn has no local start history; per-digest attribution is incomplete.",
    });

  return ConstellationStats.make({
    constellationId: graph.id,
    revision: graph.revision,
    hostId: graph.hostId,
    asOf: new Date(asOf).toISOString(),
    sequence: Sequence.make(history.sequence),
    wallClockMs: Math.max(0, completedAt(events, asOf) - Date.parse(graph.createdAt)),
    usageIndexedAt: usage.indexedAt,
    indexing: usage.indexing,
    lead,
    review: cached?.review ?? reviewStats(graph, events),
    workers: { attempts, totals: sumTimes(attempts.map((a) => a.times)) },
    usage: cached?.usage ?? attributeUsage(graph, events, usage.responses, asOf),
    coverage,
  });
};
