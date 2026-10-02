import { ConstellationEvent, NotificationItem } from "@polaris/protocol";
import type { GraphDecision } from "../decision.ts";
import { activeAttempt } from "../projections.ts";

/** Handover commands stop only Gate Attempts attached to the departing Lead. */
export const stopLeadGates = (d: GraphDecision) => {
  for (const attempt of d.record.graph.attempts) {
    const task = d.record.graph.tasks.find((t) => t.id === attempt.taskId);

    if (
      task?.kind !== "gate" ||
      attempt.sessionId !== d.record.graph.leadSessionId ||
      !activeAttempt(attempt)
    )
      continue;
    d.emit(
      ConstellationEvent.cases.AttemptSettled.make({
        ...d.fields(),
        attemptId: attempt.id,
        attemptRevision: attempt.revision + 1,
        outcome: "lost",
        reason: "stopped by handover",
      })
    );
    d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: "lost" }));
  }
};
