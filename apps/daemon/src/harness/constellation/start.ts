import { Effect } from "effect";
import { McpBinding } from "../../mcp/binding.ts";
import { workerBrief, type WorkerAssignment, type WorkerStartup } from "./worker.ts";

/** Called after AttemptStarted commits; provisioning the Worktree happens before the decider. */
export const startWorker = Effect.fn("startWorker")(function* <R, S>(
  assignment: WorkerAssignment,
  startup: WorkerStartup<R, S>
) {
  const attachment = yield* startup.attach(
    McpBinding.cases.Worker.make({
      sessionId: assignment.attempt.sessionId,
      constellationId: assignment.constellationId,
      attemptId: assignment.attempt.id,
    })
  );

  yield* startup.startSession({
    assignment,
    attachment,
    title: `${assignment.task.id} · ${assignment.task.title}`,
    prompt: workerBrief(assignment),
  });
});
