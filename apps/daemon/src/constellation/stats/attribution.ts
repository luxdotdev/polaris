import type {
  Attempt,
  Constellation,
  ConstellationStats,
  EventEnvelope,
  SessionId,
  TaskId,
} from "@polaris/protocol";
import { Predicate } from "effect";
import type { UsageResponse } from "../../usage/responses.ts";
import { sumUsage } from "./usage.ts";

export const completedAt = (events: ReadonlyArray<EventEnvelope>, now: number) => {
  const completed = events.find(
    ({ event }) =>
      Predicate.isTagged(event, "ConstellationStateChanged") && event.state === "completed"
  );

  return Math.min(now, completed === undefined ? now : Date.parse(completed.occurredAt));
};

export const leadSpans = (
  graph: Constellation,
  events: ReadonlyArray<EventEnvelope>,
  now: number
) => {
  const initial = events.find(({ event }) =>
    Predicate.isTagged(event, "ConstellationStarted")
  )?.event;

  let sessionId =
    initial !== undefined && Predicate.isTagged(initial, "ConstellationStarted")
      ? initial.constellation.leadSessionId
      : graph.leadSessionId;

  let from = Date.parse(graph.createdAt);
  const spans: { sessionId: SessionId; from: number; to: number }[] = [];

  for (const { event, occurredAt } of events) {
    if (!Predicate.isTagged(event, "LeadChanged")) continue;
    const at = Date.parse(occurredAt);
    spans.push({ sessionId, from, to: at });
    sessionId = event.to;
    from = at;
  }

  spans.push({ sessionId, from, to: completedAt(events, now) });

  return spans;
};

const assigned = (attempt: Attempt, response: UsageResponse, now: number) =>
  attempt.sessionId === response.bucket.sessionId &&
  Date.parse(response.at) >= Date.parse(attempt.startedAt) &&
  Date.parse(response.at) <
    Math.min(now, Date.parse(attempt.endedAt ?? new Date(now).toISOString()));

export const attributeUsage = (
  graph: Constellation,
  events: ReadonlyArray<EventEnvelope>,
  responses: ReadonlyArray<UsageResponse>,
  now: number
): ConstellationStats["usage"] => {
  const spans = leadSpans(graph, events, now);
  const lead: UsageResponse[] = [];
  const worker: UsageResponse[] = [];
  const perTask = new Map<TaskId, UsageResponse[]>(graph.tasks.map((t) => [t.id, []]));

  for (const response of responses) {
    const at = Date.parse(response.at);

    const isLead = spans.some(
      (s) => s.sessionId === response.bucket.sessionId && at >= s.from && at < s.to
    );

    const attempt = graph.attempts.findLast((a) => assigned(a, response, now));

    if (isLead) lead.push(response);
    else if (attempt !== undefined) worker.push(response);

    if (attempt !== undefined) perTask.get(attempt.taskId)?.push(response);
  }

  return {
    total: sumUsage([...lead, ...worker].map((r) => r.bucket)),
    perRole: [
      { role: "lead", usage: sumUsage(lead.map((r) => r.bucket)) },
      { role: "worker", usage: sumUsage(worker.map((r) => r.bucket)) },
    ],
    perTask: [...perTask].map(([taskId, rows]) => ({
      taskId,
      usage: sumUsage(rows.map((r) => r.bucket)),
    })),
  };
};

export const digestStats = (
  events: ReadonlyArray<EventEnvelope>,
  sessions: ReadonlyMap<SessionId, ReadonlyArray<EventEnvelope>>,
  responses: ReadonlyArray<UsageResponse>,
  now: number
) => {
  const notifications = events.flatMap(({ event }) =>
    Predicate.isTagged(event, "LeadNotified") ? [event] : []
  );

  const complete = notifications.every((n) =>
    sessions
      .get(n.leadSessionId)
      ?.some(({ event }) => Predicate.isTagged(event, "TurnStarted") && event.turn.id === n.turnId)
  );

  const digests = notifications.map((n) => {
    const history = sessions.get(n.leadSessionId) ?? [];

    const start = history.find(
      ({ event }) => Predicate.isTagged(event, "TurnStarted") && event.turn.id === n.turnId
    )?.event;

    const end = history.find(
      ({ event }) => Predicate.isTagged(event, "TurnEnded") && event.turn.id === n.turnId
    )?.event;

    const from =
      start !== undefined && Predicate.isTagged(start, "TurnStarted")
        ? Date.parse(start.turn.startedAt)
        : null;

    const to =
      end !== undefined && Predicate.isTagged(end, "TurnEnded")
        ? Date.parse(end.turn.endedAt ?? new Date(now).toISOString())
        : now;

    const rows =
      from === null
        ? []
        : responses.filter(
            (r) =>
              r.bucket.sessionId === n.leadSessionId &&
              Date.parse(r.at) >= from &&
              Date.parse(r.at) < to
          );

    return {
      turnId: n.turnId,
      sessionId: n.leadSessionId,
      items: n.items.length,
      usage: sumUsage(rows.map((r) => r.bucket)),
    };
  });

  const deliveredItems = digests.reduce((n, d) => n + d.items, 0);
  const coalescedItems = digests.reduce((n, d) => n + Math.max(0, d.items - 1), 0);

  const tokens = digests.reduce(
    (n, d) =>
      n +
      d.usage.tokens.input +
      d.usage.tokens.cacheRead +
      d.usage.tokens.cacheWrite +
      d.usage.tokens.output,
    0
  );

  return {
    wakeups: digests.length,
    deliveredItems,
    coalescedItems,
    coalescingHitRate: deliveredItems === 0 ? null : coalescedItems / deliveredItems,
    meanTokensPerDigest: !complete || digests.length === 0 ? null : tokens / digests.length,
    meanReportedUsdPerDigest:
      !complete || digests.length === 0
        ? null
        : digests.reduce((n, d) => n + d.usage.reportedUsd, 0) / digests.length,
    digests,
  };
};
