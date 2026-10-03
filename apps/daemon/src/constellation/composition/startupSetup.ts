import {
  WorktreeSetup,
  CommandId,
  CommandRejected,
  type Attempt,
  type Constellation,
} from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { decideSession } from "../../engine/session.ts";
import { ServiceError } from "../../services.ts";
import type { WorkerPreparation } from "../transfers/prepareWorkers.ts";
import { setupCommand, WorktreeSetupService } from "../setup/index.ts";

/** A retry's deferred setup intent survives restart and runs before the first brief. */
export const runStartupSetup = Effect.fnUntraced(function* (
  graph: Constellation,
  attempt: Attempt
) {
  if (attempt.startupSetup === null) return;
  const setup = yield* WorktreeSetupService;

  const setting =
    attempt.startupSetup.command === null
      ? WorktreeSetup.cases.Auto.make({})
      : WorktreeSetup.cases.Command.make({ command: attempt.startupSetup.command });

  const result = yield* setup
    .run(
      attempt.sessionId,
      attempt.id,
      attempt.worktree,
      setting,
      graph.id,
      attempt.taskId,
      attempt.startupSetup.force === true
    )
    .pipe(
      Effect.mapError(
        (error) => new ServiceError({ service: "WorktreeSetup", message: error.reason })
      )
    );

  if (result?.status === "failed")
    return yield* new ServiceError({
      service: "WorktreeSetup",
      message: `Retry setup failed: ${result.command}. Repair setup, stop this Attempt and dispatch again.`,
    });
});

export const startupSetupIntent = Effect.fnUntraced(function* (input: WorkerPreparation) {
  const setting = input.worktreeSetup ?? null;
  const command = yield* setupCommand(input.worktree.worktree, setting);

  if (command === "") return null;

  return {
    command: setting !== null && Predicate.isTagged(setting, "Command") ? setting.command : null,
    force: input.forceSetup === true,
  };
});

/** A durable failed-startup receipt clears the fence even after manual setup repair or Retry. */
export const recordStartupFailure = Effect.fnUntraced(function* (
  attempt: Attempt,
  error: ServiceError
) {
  const store = yield* EventStore;
  const commandId = CommandId.make(`${attempt.id}:startup-failed`);
  yield* store
    .commit({
      recordRejection: false,
      commandId,
      decide: (model) => {
        const decision = decideSession(model.sessions.get(attempt.sessionId), {
          type: "session.fail",
          at: new Date().toISOString(),
          message:
            error.service === "WorktreeSetup"
              ? `Worktree setup failed: ${error.message}`
              : `Worker startup failed: ${error.message}`,
        });

        return decision.rejection === null && decision.events.length > 0
          ? Effect.succeed(decision.events)
          : Effect.fail(
              new CommandRejected({
                commandId,
                reason: decision.rejection ?? "Worker Session is unavailable",
              })
            );
      },
    })
    .pipe(
      Effect.catchTag("CommandRejected", () => Effect.void),
      Effect.catchTag("ServiceError", Effect.die)
    );
});
