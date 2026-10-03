import { type Attempt, ConstellationEvent, NotificationItem } from "@polaris/protocol";
import type { GraphCommand } from "../engine/constellation.inputs.ts";
import type { ConstellationRecord } from "../store/constellation.ts";
import type { GraphDecision } from "./decision.ts";
import { accepted, latestAttempt } from "./projections.ts";

export const blockAttempt = (
  d: GraphDecision,
  command: GraphCommand<"WorkerBlock">,
  attempt: Attempt
) => {
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

/** A stable pending input is re-derived from the durable block after a restart. */
export const acceptedBlockInput = (record: ConstellationRecord, attempt: Attempt) => {
  if (
    attempt.state !== "blocked" ||
    attempt.blockedOn.length === 0 ||
    !attempt.blockedOn.every((id) => accepted(record.graph, id))
  )
    return null;

  const heads = attempt.blockedOn
    .map((id) => `${id} accepted at ${latestAttempt(record.graph, id)?.mergedHead}`)
    .join("; ");

  return {
    id: JSON.stringify(["unblock", attempt.id, attempt.blockedAt, attempt.blockedOn]),
    sessionId: attempt.sessionId,
    text: `${heads}. Merge it into your branch and continue ${attempt.taskId}; call claim when finished, or block again.`,
  };
};
