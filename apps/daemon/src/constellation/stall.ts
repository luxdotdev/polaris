import { StallAudit, type Attempt, type TaskId } from "@polaris/protocol";
import { Predicate } from "effect";
import type { ConstellationRecord } from "../store/constellation.ts";
import type { SessionRecord } from "../store/model.ts";
import { pendingInputs } from "./delivery/messages.ts";
import { isParent } from "./parents.ts";
import { activeAttempt, latestAttempt, projectTask } from "./projections.ts";

type Sessions = ReadonlyMap<Attempt["sessionId"], SessionRecord>;

const hasWorkingTurn = (sessions: Sessions, sessionId: Attempt["sessionId"]) =>
  sessions.get(sessionId)?.turns.some((t) => t.status === "working") === true;

/** The brief ran, the last Turn ended cleanly, the nudge is spent, and nothing is queued. */
const silentWorker = (record: ConstellationRecord, sessions: Sessions, a: Attempt) => {
  const session = sessions.get(a.sessionId);
  const last = session?.turns.at(-1);

  return (
    a.state === "working" &&
    a.nudgedAt !== null &&
    a.sessionId !== record.graph.leadSessionId &&
    latestAttempt(record.graph, a.taskId)?.id === a.id &&
    !record.stale.has(a.id) &&
    last !== undefined &&
    last.startedAt >= a.startedAt &&
    last.status === "completed" &&
    !record.graph.pendingNotifications.some(
      (n) => Predicate.isTagged(n.item, "Stopped") && n.item.attemptId === a.id
    )
  );
};

const silentWorkers = (record: ConstellationRecord, sessions: Sessions): ReadonlyArray<TaskId> => {
  const queued = new Set(pendingInputs(record).map((i) => i.sessionId));

  return record.graph.attempts
    .filter((a) => !queued.has(a.sessionId) && silentWorker(record, sessions, a))
    .map((a) => a.taskId);
};

/** A promoted Gate nobody is carrying: ready work with no owner. */
export const stalledGates = (record: ConstellationRecord): ReadonlyArray<TaskId> =>
  record.graph.tasks
    .filter((task) => {
      const attempt = latestAttempt(record.graph, task.id);

      return (
        task.kind === "gate" &&
        !task.canceled &&
        record.promoted.has(task.id) &&
        (attempt === undefined || !activeAttempt(attempt)) &&
        attempt?.state !== "accepted"
      );
    })
    .map((task) => task.id);

/** The Lead heard everything, its Turn ended, and the whole Constellation still waits on it. */
const silentLead = (record: ConstellationRecord, sessions: Sessions, gates: number) => {
  const { graph } = record;
  const lead = sessions.get(graph.leadSessionId);

  if (
    lead === undefined ||
    lead.turns.length === 0 ||
    hasWorkingTurn(sessions, graph.leadSessionId) ||
    graph.pendingNotifications.length > 0 ||
    pendingInputs(record).some((i) => i.sessionId === graph.leadSessionId)
  )
    return false;

  if (graph.attempts.some((a) => activeAttempt(a) && a.state !== "review")) return false;

  const ready = graph.tasks.some(
    (task) => !isParent(graph, task.id) && projectTask(record, task).state === "ready"
  );

  return gates > 0 || ready || graph.attempts.some((a) => a.state === "review");
};

/**
 * Demand-driven: computed from the fold and the Session records at a trigger point, never
 * on a timer. Returns null when nothing has stalled.
 */
export const stallAudit = (record: ConstellationRecord, sessions: Sessions): StallAudit | null => {
  if (record.graph.state !== "running") return null;
  const working = silentWorkers(record, sessions);
  const gates = stalledGates(record);
  const lead = silentLead(record, sessions, gates.length);

  if (working.length === 0 && gates.length === 0 && !lead) return null;

  return new StallAudit({
    key: JSON.stringify([
      [...working].sort(),
      [...gates].sort(),
      lead,
      record.graph.attempts.filter((a) => a.state === "review").map((a) => a.id),
    ]),
    working,
    gates,
    lead,
  });
};

/** The same stalled state is noted to the Lead once; a changed state is a new audit. */
export const dueAudit = (record: ConstellationRecord, sessions: Sessions): StallAudit | null => {
  const audit = stallAudit(record, sessions);

  return audit === null || audit.key === record.lastAudit ? null : audit;
};

export const auditLines = (audit: StallAudit): ReadonlyArray<string> => {
  const lines: Array<string> = [];

  if (audit.working.length > 0)
    lines.push(
      `Stalled: ${audit.working.join(", ")} ${audit.working.length === 1 ? "is" : "are"} working with no active Turn and no queued input. Message the worker with a concrete next action, or stop the Attempt.`
    );

  if (audit.gates.length > 0)
    lines.push(
      `Ready and unclaimed: Gate ${audit.gates.join(", ")} ${audit.gates.length === 1 ? "has" : "have"} every dependency accepted and no Attempt. Dispatch it to your own session and run its checks.`
    );

  if (audit.lead)
    lines.push(
      "Nothing is in flight. Review the pending Claims, dispatch the ready Tasks, or say what blocks you."
    );

  return lines;
};
