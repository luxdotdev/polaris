import { ConstellationEvent } from "@polaris/protocol";
import type { GraphCommand } from "../../engine/constellation.inputs.ts";
import type { GraphDecision } from "../decision.ts";
import { latestAttempt } from "../projections.ts";
import { logbookWriter } from "./access.ts";

/** A note is a record on one Task's Logbook: nothing is delivered and no state changes. */
export const note = (d: GraphDecision, command: GraphCommand<"Note">) => {
  if (!d.record.graph.tasks.some((task) => task.id === command.taskId)) {
    d.reject(
      "E-TASK-UNKNOWN",
      `Task ${command.taskId} does not exist`,
      "Read status for the Task ids."
    );

    return;
  }

  const author = logbookWriter(d.ctx.binding, d.record, command.taskId);

  if (author === null) {
    d.reject(
      "E-AUTHORITY",
      `Only ${command.taskId}'s current Attempt, the Lead or the user writes to its Logbook`,
      "Write notes on your own Task; message a peer to reach another."
    );

    return;
  }

  const fields = d.fields();
  d.emit(
    ConstellationEvent.cases.LogbookNoted.make({
      ...fields,
      id: `${fields.constellationId}:${fields.revision}:note`,
      taskId: command.taskId,
      attemptId: latestAttempt(d.record.graph, command.taskId)?.id ?? null,
      author,
      text: command.text,
      actor: d.actor(),
    })
  );
};
