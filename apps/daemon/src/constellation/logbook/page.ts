/** A read of a Logbook as a page: who may read it, its Attempt boundaries and its entries. */
import {
  type ConstellationId,
  LogbookAttempt,
  type LogbookEntry,
  LogbookPage,
  Sequence,
  type TaskId,
} from "@polaris/protocol";
import type { ConstellationBinding } from "../../engine/constellation.inputs.ts";
import type { ConstellationRecord } from "../../store/constellation.ts";
import type { ReadModel } from "../../store/model.ts";
import { finding } from "../decision.ts";
import { canReadLogbook, readsEveryLogbook } from "./access.ts";
import type { LogbookFold } from "./fold.ts";

/** Which Logbook a read asks for; `taskId` absent is every Task's. */
export interface LogbookScope {
  readonly constellationId: ConstellationId;
  readonly taskId?: TaskId | undefined;
  readonly since?: Sequence | undefined;
}

/** Why `binding` may not read `scope`, or null when it may. */
export const logbookRefusal = (
  binding: ConstellationBinding,
  record: ConstellationRecord,
  scope: LogbookScope
) => {
  const { taskId } = scope;

  if (taskId === undefined)
    return readsEveryLogbook(binding, record)
      ? null
      : finding(
          "E-AUTHORITY",
          "Only the Lead and the user read every Task's Logbook",
          "Name the Task whose Logbook you need."
        );

  if (!record.graph.tasks.some((task) => task.id === taskId))
    return finding(
      "E-TASK-UNKNOWN",
      `Task ${taskId} does not exist`,
      "Read status for the Task ids."
    );

  return canReadLogbook(binding, record, taskId)
    ? null
    : finding(
        "E-AUTHORITY",
        `${taskId}'s Logbook is read by its own worker, the workers of Tasks that depend on it, the Lead and the user`,
        "Read your own Task's Logbook, or one your Task depends on."
      );
};

/** The Attempt boundaries in scope, oldest first, as the graph stands now. */
export const logbookAttempts = (
  fold: LogbookFold,
  scope: LogbookScope,
  sessions?: ReadModel["sessions"]
): ReadonlyArray<LogbookAttempt> =>
  (fold.record?.graph.attempts ?? []).flatMap((attempt) => {
    const ordinal = fold.ordinals.get(attempt.id);

    if (ordinal === undefined || (scope.taskId !== undefined && attempt.taskId !== scope.taskId))
      return [];

    const session = sessions?.get(attempt.sessionId)?.session;

    return [
      new LogbookAttempt({
        taskId: attempt.taskId,
        attemptId: attempt.id,
        number: ordinal.number,
        cause: attempt.cause._tag,
        sessionId: attempt.sessionId,
        hostId: attempt.hostId,
        harness: session?.harness ?? null,
        model: session?.model ?? null,
        state: attempt.state,
        sequence: ordinal.sequence,
        startedAt: attempt.startedAt,
        endedAt: attempt.endedAt,
      }),
    ];
  });

/** The entries of `scope`: its Task's (or every Task's), after its `since`. */
export const inScope = (entries: ReadonlyArray<LogbookEntry>, scope: LogbookScope) =>
  entries.filter(
    (entry) =>
      (scope.taskId === undefined || entry.taskId === scope.taskId) &&
      (scope.since === undefined || entry.sequence > scope.since)
  );

export const logbookPage = (
  fold: LogbookFold,
  entries: ReadonlyArray<LogbookEntry>,
  scope: LogbookScope,
  cursor: number,
  sessions?: ReadModel["sessions"]
) =>
  new LogbookPage({
    constellationId: scope.constellationId,
    taskId: scope.taskId ?? null,
    attempts: logbookAttempts(fold, scope, sessions),
    entries: inScope(entries, scope),
    cursor: Sequence.make(cursor),
  });
