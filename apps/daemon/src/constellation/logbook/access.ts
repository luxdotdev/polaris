/** Who writes to and reads a Task's Logbook (ADR 0119). Pure: the fold and a binding in, an answer out. */
import type { LogbookNoteAuthor, TaskId } from "@polaris/protocol";
import type { ConstellationBinding } from "../../engine/constellation.inputs.ts";
import type { ConstellationRecord } from "../../store/constellation.ts";
import { effectiveDeps } from "../parents.ts";
import { activeAttempt, latestAttempt } from "../projections.ts";

/** The session working a Task now: its latest Attempt's, while that Attempt is active. */
const workerOf = (record: ConstellationRecord, taskId: TaskId) => {
  const attempt = latestAttempt(record.graph, taskId);

  return attempt !== undefined && activeAttempt(attempt) ? attempt.sessionId : null;
};

/** The role a binding writes a Task's Logbook as, or null when it may not write. */
export const logbookWriter = (
  binding: ConstellationBinding,
  record: ConstellationRecord,
  taskId: TaskId
): LogbookNoteAuthor | null => {
  if (binding.kind === "user") return "you";

  if (binding.sessionId === record.graph.leadSessionId) return "lead";

  return workerOf(record, taskId) === binding.sessionId ? "worker" : null;
};

/** The Lead and the user read every Task's Logbook. */
export const readsEveryLogbook = (binding: ConstellationBinding, record: ConstellationRecord) =>
  binding.kind === "user" || binding.sessionId === record.graph.leadSessionId;

/** A Task's writers read it, and so does the worker of each Task that depends on it. */
export const canReadLogbook = (
  binding: ConstellationBinding,
  record: ConstellationRecord,
  taskId: TaskId
): boolean =>
  logbookWriter(binding, record, taskId) !== null ||
  (binding.kind === "session" &&
    record.graph.tasks.some(
      (task) =>
        !task.canceled &&
        workerOf(record, task.id) === binding.sessionId &&
        effectiveDeps(record.graph.tasks, task.id).includes(taskId)
    ));
