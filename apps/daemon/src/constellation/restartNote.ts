import type { BackgroundTask, DomainEvent, EventEnvelope, SessionId } from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import type { EventStore } from "../store/EventStore.ts";

/** The Session machine's recovery reasons (engine/session.ts `recover`). */
const RESTART_REASONS: ReadonlySet<string> = new Set([
  "interrupted",
  "daemon-restart",
  "daemon-upgrade",
]);

export interface LostWork {
  readonly kind: "command" | "subagent";
  readonly label: string;
}

/**
 * Commits carry no batch id, so the restart batch is grouped by commit time. A restart's
 * batch is committed by a newly started Daemon, so it never shares a millisecond with work
 * from before the restart.
 */
interface Scan {
  tasks: ReadonlyArray<BackgroundTask>;
  /** Work ended in the batch being read, keyed by its commit time. */
  ending: { at: string; work: Array<LostWork> } | null;
  lost: ReadonlyArray<LostWork>;
}

const add = (scan: Scan, at: string, work: ReadonlyArray<LostWork>) => {
  if (scan.ending?.at !== at) scan.ending = { at, work: [] };

  for (const item of work)
    if (!scan.ending.work.some((w) => w.kind === item.kind && w.label === item.label))
      scan.ending.work.push(item);
};

const step = (scan: Scan, event: DomainEvent, at: string) => {
  if (Predicate.isTagged(event, "SessionBackgroundTasksChanged")) {
    if (event.tasks.length === 0)
      add(
        scan,
        at,
        scan.tasks.map((t) => ({ kind: t.kind, label: t.description }))
      );
    scan.tasks = event.tasks;
  } else if (Predicate.isTagged(event, "SubagentEnded") && event.subagent.status === "interrupted")
    add(scan, at, [{ kind: "subagent", label: event.subagent.title }]);
  else if (
    Predicate.isTagged(event, "SessionStateChanged") &&
    event.reason !== null &&
    RESTART_REASONS.has(event.reason)
  )
    scan.lost = scan.ending?.at === at ? scan.ending.work : [];
  else if (Predicate.isTagged(event, "TurnStarted")) scan.lost = [];
};

/**
 * Background work a Daemon restart stopped, when no Turn has run since: the restart's own
 * batch cleared the tasks and ended its Subagents. Read from this Session's events only.
 */
export const lostToRestart = (envelopes: ReadonlyArray<EventEnvelope>): ReadonlyArray<LostWork> => {
  const scan: Scan = { tasks: [], ending: null, lost: [] };

  for (const envelope of envelopes) step(scan, envelope.event, envelope.occurredAt);

  return scan.lost;
};

/** What the next Turn after a restart tells the agent; null when nothing was lost. */
export const restartNote = (envelopes: ReadonlyArray<EventEnvelope>): string | null => {
  const lost = lostToRestart(envelopes);

  if (lost.length === 0) return null;

  return [
    "The Polaris Daemon restarted, so this background work was stopped. It will not report back:",
    ...lost.map((w) => `- ${w.kind}: ${w.label}`),
    "Start again whatever you still need; do not wait for it.",
  ].join("\n");
};

const NOTE_EVENTS: ReadonlyArray<DomainEvent["_tag"]> = [
  "SessionBackgroundTasksChanged",
  "SubagentEnded",
  "SessionStateChanged",
  "TurnStarted",
];

/**
 * Reads only the four event kinds the note needs from this Session's stream. Pass `upTo`
 * (the sequence before a just-committed Continue) to read the note as that Turn's prompt.
 */
export const sessionRestartNote = (
  store: EventStore["Service"],
  sessionId: SessionId,
  before?: number
) =>
  Effect.gen(function* () {
    const upTo = before ?? (yield* store.model).sequence;

    const events = yield* store
      .readEvents({ after: 0, upTo, sessionId, eventTypes: NOTE_EVENTS })
      .pipe(Effect.orElseSucceed(() => []));

    return restartNote(events);
  });
