import type {
  Attempt,
  DomainEvent,
  EventEnvelope,
  SessionId,
  WorkerTimes,
} from "@polaris/protocol";
import { Match, Predicate } from "effect";
import { overlap, unionDuration } from "./intervals.ts";
import { staleDuration, type StaleTransition } from "./stale.ts";

export interface WaitInterval {
  readonly sessionId: SessionId | null;
  readonly resource: string;
  readonly from: number;
  readonly to: number;
}

const queueEnd = (event: DomainEvent) =>
  Match.value(event).pipe(
    Match.tags({
      ResourceLeased: ({ lease }) => ({ id: lease.id, sessionId: lease.sessionId }),
      ResourceLeaseCanceled: ({ requestId }) => ({ id: requestId, sessionId: null }),
      ResourceReleased: ({ leaseId }) => ({ id: leaseId, sessionId: null }),
    }),
    Match.orElse(() => null)
  );

export const leaseWaits = (
  events: ReadonlyArray<EventEnvelope>,
  now: number
): ReadonlyArray<WaitInterval> => {
  const queued = new Map<string, { sessionId: SessionId | null; resource: string; from: number }>();
  const intervals: WaitInterval[] = [];

  for (const envelope of events) {
    const e = envelope.event;

    if (Predicate.isTagged(e, "ResourceLeaseQueued"))
      queued.set(e.requestId, {
        sessionId: e.sessionId,
        resource: e.resource,
        from: Date.parse(envelope.occurredAt),
      });

    const ended = queueEnd(e);

    if (ended === null) continue;
    const pending = queued.get(ended.id);

    if (pending === undefined) continue;
    queued.delete(ended.id);
    intervals.push({
      ...pending,
      sessionId: pending.sessionId ?? ended.sessionId,
      to: Date.parse(envelope.occurredAt),
    });
  }

  for (const pending of queued.values()) intervals.push({ ...pending, to: now });

  return intervals;
};

export const workingEnd = (attempt: Attempt, events: ReadonlyArray<EventEnvelope>, now: number) => {
  const left = events.find(
    ({ event }) =>
      "attemptId" in event &&
      event.attemptId === attempt.id &&
      (Predicate.isTagged(event, "AttemptClaimed") ||
        Predicate.isTagged(event, "AttemptRejected") ||
        Predicate.isTagged(event, "AttemptAccepted") ||
        Predicate.isTagged(event, "AttemptSettled"))
  );

  return Math.min(
    now,
    left === undefined
      ? Date.parse(attempt.endedAt ?? new Date(now).toISOString())
      : Date.parse(left.occurredAt)
  );
};

const sessionTimes = (events: ReadonlyArray<EventEnvelope>, start: number, end: number) => {
  let state: string | null = null;
  let since = start;
  let working = 0;
  let idle = 0;

  const add = (until: number) => {
    const elapsed = overlap(since, until, start, end);

    if (state === "working") working += elapsed;

    if (state === "idle") idle += elapsed;
  };

  for (const envelope of events) {
    const e = envelope.event;

    const next = Predicate.isTagged(e, "SessionCreated")
      ? e.session.state
      : Predicate.isTagged(e, "SessionStateChanged")
        ? e.state
        : null;

    if (next === null) continue;
    const at = Date.parse(envelope.occurredAt);
    add(at);
    state = next;
    since = at;
  }

  add(end);

  return { workingMs: state === null ? null : working, idleMs: state === null ? null : idle };
};

export const workerTimes = (options: {
  readonly attempt: Attempt;
  readonly graphEvents: ReadonlyArray<EventEnvelope>;
  readonly sessionEvents: ReadonlyArray<EventEnvelope>;
  readonly waits: ReadonlyArray<WaitInterval>;
  readonly stale: ReadonlyArray<StaleTransition>;
  readonly now: number;
  readonly local: boolean;
}): WorkerTimes => {
  const { attempt } = options;
  const start = Date.parse(attempt.startedAt);
  const end = workingEnd(attempt, options.graphEvents, options.now);

  const waits = options.waits.filter(
    (w) => w.sessionId === attempt.sessionId && overlap(w.from, w.to, start, end) > 0
  );

  const slots = waits.filter((w) => w.resource === "__workers");

  const hasSlotFact = options.waits.some(
    (w) =>
      w.sessionId === attempt.sessionId &&
      w.resource === "__workers" &&
      w.from >= start &&
      w.from <= end
  );

  return {
    ...(options.local
      ? sessionTimes(options.sessionEvents, start, end)
      : { workingMs: null, idleMs: null }),
    waitingForSlotMs: options.local && hasSlotFact ? unionDuration(slots, start, end) : null,
    waitingOnLeaseMs: options.local
      ? unionDuration(
          waits.filter((w) => w.resource !== "__workers"),
          start,
          end
        )
      : null,
    staleMs: staleDuration(
      options.stale,
      attempt.id,
      start,
      Math.min(options.now, Date.parse(attempt.endedAt ?? new Date(options.now).toISOString()))
    ),
  };
};

export const sumTimes = (times: ReadonlyArray<WorkerTimes>): WorkerTimes => {
  const sum = (key: keyof WorkerTimes) =>
    times.some((t) => t[key] === null) ? null : times.reduce((n, t) => n + (t[key] ?? 0), 0);

  return {
    workingMs: sum("workingMs"),
    idleMs: sum("idleMs"),
    waitingForSlotMs: sum("waitingForSlotMs"),
    waitingOnLeaseMs: sum("waitingOnLeaseMs"),
    staleMs: sum("staleMs"),
  };
};
