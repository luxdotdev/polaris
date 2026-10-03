import {
  WorktreeSetup,
  type Attempt,
  type Constellation,
  type WorktreeSetupRun,
} from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { ServiceError } from "../../services.ts";
import type { WorkerPreparation } from "../transfers/prepareWorkers.ts";
import { setupFingerprint } from "../setup/inputs.ts";
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

  const store = yield* EventStore;

  const previous =
    (yield* store.model).sessions.get(attempt.sessionId)?.session.worktreeSetup ?? null;

  if (
    !(yield* needsSetup(attempt.worktree, setting, previous, attempt.startupSetup.force === true))
  )
    return;

  const result = yield* setup
    .run(attempt.sessionId, attempt.id, attempt.worktree, setting, graph.id, attempt.taskId)
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

export const needsSetup = Effect.fnUntraced(function* (
  cwd: string,
  setting: WorktreeSetup | null,
  previous: WorktreeSetupRun | null,
  force: boolean
) {
  const command = yield* setupCommand(cwd, setting);

  if (command === "") return false;
  const fingerprint = yield* setupFingerprint(cwd, command);

  return (
    force ||
    previous?.status !== "completed" ||
    previous.cwd !== cwd ||
    previous.fingerprint !== fingerprint
  );
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
