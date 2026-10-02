import type {
  AttemptId,
  Constellation,
  DomainEvent,
  EventEnvelope,
  TaskId,
} from "@polaris/protocol";
import { Predicate } from "effect";

interface PendingClaim {
  at: number;
  first: boolean;
  reviewed: boolean;
}

const recordClaim = (
  graph: Constellation,
  claims: Map<AttemptId, PendingClaim>,
  firstTasks: Set<TaskId>,
  event: DomainEvent,
  occurredAt: string
) => {
  if (!Predicate.isTagged(event, "AttemptClaimed")) return;
  const attempt = graph.attempts.find((a) => a.id === event.attemptId);

  if (attempt === undefined) return;
  claims.set(attempt.id, {
    at: Date.parse(occurredAt),
    first: !firstTasks.has(attempt.taskId),
    reviewed: false,
  });
  firstTasks.add(attempt.taskId);
};

const claimDecisions = (graph: Constellation, events: ReadonlyArray<EventEnvelope>) => {
  const claims = new Map<AttemptId, PendingClaim>();
  const firstTasks = new Set<TaskId>();
  const waits: number[] = [];
  let acceptedFirstTime = 0;
  let firstClaimsReviewed = 0;

  for (const { event, occurredAt } of events) {
    recordClaim(graph, claims, firstTasks, event, occurredAt);

    if (
      !(
        Predicate.isTagged(event, "ClaimApproved") ||
        Predicate.isTagged(event, "AttemptAccepted") ||
        Predicate.isTagged(event, "AttemptRejected") ||
        Predicate.isTagged(event, "AttemptSettled")
      )
    )
      continue;
    const claim = claims.get(event.attemptId);

    if (claim === undefined) continue;

    if (!claim.reviewed) waits.push(Math.max(0, Date.parse(occurredAt) - claim.at));
    claim.reviewed = true;

    if (Predicate.isTagged(event, "ClaimApproved")) continue;
    claims.delete(event.attemptId);

    if (claim.first) {
      firstClaimsReviewed++;

      if (Predicate.isTagged(event, "AttemptAccepted")) acceptedFirstTime++;
    }
  }

  return { waits, acceptedFirstTime, firstClaimsReviewed };
};

export const reviewStats = (graph: Constellation, events: ReadonlyArray<EventEnvelope>) => {
  const { waits, acceptedFirstTime, firstClaimsReviewed } = claimDecisions(graph, events);
  const sorted = waits.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
        : (sorted[middle] ?? null);

  const causes = new Map<string, number>();

  for (const attempt of graph.attempts) {
    if (
      !(
        Predicate.isTagged(attempt.cause, "SentBack") ||
        Predicate.isTagged(attempt.cause, "MergeConflict")
      )
    )
      continue;
    const cause = attempt.cause._tag;
    causes.set(cause, (causes.get(cause) ?? 0) + 1);
  }

  return {
    decidedClaims: waits.length,
    meanClaimToReviewMs:
      waits.length === 0 ? null : waits.reduce((n, t) => n + t, 0) / waits.length,
    medianClaimToReviewMs: median,
    acceptedFirstTime,
    firstClaimsReviewed,
    firstTimeAcceptanceRate:
      firstClaimsReviewed === 0 ? null : acceptedFirstTime / firstClaimsReviewed,
    sendBacksByCause: [...causes].map(([cause, count]) => ({ cause, count })),
  };
};
