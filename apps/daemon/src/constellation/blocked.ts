import { type Attempt, type TaskId, ConstellationEvent, NotificationItem } from "@polaris/protocol";
import type { GraphCommand } from "../engine/constellation.inputs.ts";
import type { ConstellationRecord } from "../store/constellation.ts";
import type { GraphDecision } from "./decision.ts";
import { MessageTarget } from "@polaris/protocol";
import { accepted, latestAttempt } from "./projections.ts";
import { completionTasks } from "./parents.ts";
import { waitClosure, waitGraph } from "./waitGraph.ts";

export const blockAttempt = (
  d: GraphDecision,
  command: GraphCommand<"WorkerBlock">,
  attempt: Attempt
) => {
  if (d.record.graph.tasks.find((t) => t.id === attempt.taskId)?.kind === "gate") {
    d.reject(
      "E-BLOCK-GATE",
      "Gate Attempts cannot block",
      "Return the Gate's verification result to the Lead."
    );

    return;
  }

  if (attempt.state !== "working") {
    d.reject(
      "E-BLOCK-STATE",
      "Only a working Attempt can block",
      "Resume the Attempt before blocking again."
    );

    return;
  }

  const on = [...new Set(command.on)];

  if (
    on.some(
      (id) => id === attempt.taskId || !d.record.graph.tasks.some((t) => t.id === id && !t.canceled)
    )
  ) {
    d.reject(
      "E-BLOCK-TARGET",
      "Block targets must be other, existing, uncanceled Tasks",
      "Choose live Tasks from status."
    );

    return;
  }

  if (on.length > 0 && on.every((id) => accepted(d.record.graph, id))) {
    d.reject(
      "E-BLOCK-SATISFIED",
      "Every block target is already accepted",
      "Merge the accepted heads and continue your Task."
    );

    return;
  }

  const edges = waitGraph(d.record.graph.tasks, d.record.graph.attempts);

  if (on.some((id) => waitClosure(edges, id).has(attempt.taskId))) {
    d.reject(
      "E-BLOCK-CYCLE",
      "A block target depends on or is blocked by this Task",
      "Choose Tasks that can finish independently of this Task."
    );

    return;
  }

  d.emit(
    ConstellationEvent.cases.AttemptBlocked.make({
      ...d.fields(),
      attemptId: attempt.id,
      attemptRevision: attempt.revision + 1,
      on,
      reason: command.reason,
      at: d.ctx.now,
    })
  );
  d.notify(
    NotificationItem.cases.Blocked.make({
      taskId: attempt.taskId,
      attemptId: attempt.id,
      on,
      reason: command.reason,
    })
  );
};

/** Earlier queued messages remain queued until an eligible input resumes the Attempt. */
export const unblocksAttempt = (record: ConstellationRecord, attempt: Attempt, id: string) => {
  if (acceptedBlockInput(record, attempt)?.id === id) return true;
  const message = record.messages.get(id);

  return (
    message !== undefined &&
    message.revision > (record.blockRevisions.get(attempt.id) ?? 0) &&
    MessageTarget.match(message.target, {
      Worker: ({ attemptId }) => attemptId === attempt.id,
      Lead: () => false,
      All: () => false,
    })
  );
};

export const cancelBlockTarget = (d: GraphDecision, taskId: TaskId, taskRevision: number) => {
  const waiting = d.record.graph.attempts.filter(
    (a) => a.state === "blocked" && a.blockedOn.includes(taskId)
  );

  d.emit(ConstellationEvent.cases.TaskCanceled.make({ ...d.fields(), taskId, taskRevision }));

  for (const attempt of waiting)
    d.notify(
      NotificationItem.cases.Blocked.make({
        taskId: attempt.taskId,
        attemptId: attempt.id,
        on: d.record.graph.attempts.find((a) => a.id === attempt.id)?.blockedOn ?? [],
        reason: `${taskId} was canceled. ${attempt.blockedReason ?? "Waiting for the Lead"}`,
      })
    );
};

/** A stable pending input is re-derived from the durable block after a restart. */
export const acceptedBlockInput = (record: ConstellationRecord, attempt: Attempt) => {
  if (
    attempt.state !== "blocked" ||
    attempt.blockedOn.length === 0 ||
    !attempt.blockedOn.every((id) => accepted(record.graph, id))
  )
    return null;

  const heads = [
    ...new Set(
      attempt.blockedOn.flatMap((id) =>
        completionTasks(record.graph.tasks, id).map((task) => task.id)
      )
    ),
  ]
    .map((id) => `${id} accepted at ${latestAttempt(record.graph, id)?.mergedHead}`)
    .join("; ");

  return {
    id: JSON.stringify(["unblock", attempt.id, attempt.blockedAt, attempt.blockedOn]),
    sessionId: attempt.sessionId,
    text: `${heads}. Merge it into your branch and continue ${attempt.taskId}; call claim when finished, or block again.`,
  };
};
