import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  CommandId,
  CommandRejected,
  WorktreeSetupRun,
  type SessionId,
  type WorktreeSetup,
  type ConstellationId,
  type TaskId,
} from "@polaris/protocol";
import { Cause, Context, Effect, Exit, Layer, Match, Option, Semaphore, Struct } from "effect";
import { decideSession } from "../../engine/session.ts";
import { EventStore } from "../../store/EventStore.ts";
import { setupFingerprint } from "./inputs.ts";
import { executeSetup } from "./process.ts";

const DEFAULTS = [
  ["bun.lock", "bun install"],
  ["package-lock.json", "npm ci"],
  ["pnpm-lock.yaml", "pnpm install"],
  ["uv.lock", "uv sync"],
] as const;

export const setupCommand = Effect.fn("WorktreeSetup.command")(function* (
  cwd: string,
  setting: WorktreeSetup | null
) {
  const override =
    setting === null
      ? null
      : Match.value(setting).pipe(
          Match.tagsExhaustive({
            Auto: () => null,
            Disabled: () => "",
            Command: (s) => s.command,
          })
        );

  if (override !== null) return override;

  for (const [lock, command] of DEFAULTS) {
    if (
      yield* Effect.promise(() =>
        access(join(cwd, lock)).then(
          () => true,
          () => false
        )
      )
    )
      return command;
  }

  return "";
});

export class WorktreeSetupService extends Context.Service<
  WorktreeSetupService,
  {
    readonly run: (
      sessionId: SessionId,
      key: string,
      cwd: string,
      setting: WorktreeSetup | null,
      constellationId: ConstellationId,
      taskId: TaskId,
      force?: boolean
    ) => Effect.Effect<WorktreeSetupRun | null, CommandRejected>;
  }
>()("polaris/daemon/WorktreeSetup") {
  static readonly layer = Layer.effect(
    WorktreeSetupService,
    Effect.gen(function* () {
      const store = yield* EventStore;
      const locks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>();

      const record = Effect.fnUntraced(function* (sessionId: SessionId, setup: WorktreeSetupRun) {
        yield* store
          .commit({
            commandId: CommandId.make(`${setup.id}:${setup.status}`),
            decide: (model) => {
              const decision = decideSession(model.sessions.get(sessionId), {
                type: "session.setup",
                setup,
              });

              return decision.rejection === null
                ? Effect.succeed(decision.events)
                : Effect.fail(
                    new CommandRejected({
                      commandId: CommandId.make(`${setup.id}:${setup.status}`),
                      reason: decision.rejection,
                    })
                  );
            },
          })
          .pipe(Effect.catchTag("ServiceError", Effect.die));
      });

      const run = Effect.fn("WorktreeSetup.run")(function* (
        sessionId: SessionId,
        key: string,
        cwd: string,
        setting: WorktreeSetup | null,
        constellationId: ConstellationId,
        taskId: TaskId,
        force = false
      ) {
        const command = yield* setupCommand(cwd, setting);

        if (command === "") return null;
        let lock = locks.get(cwd);

        if (lock === undefined) {
          lock = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
          locks.set(cwd, lock);
        }

        const currentLock = lock;
        currentLock.users++;

        return yield* currentLock.semaphore
          .withPermit(
            Effect.gen(function* () {
              const previous = (yield* store.model).sessions.get(sessionId)?.session.worktreeSetup;

              const fingerprint =
                !force &&
                previous?.status === "completed" &&
                previous.cwd === cwd &&
                previous.command === command
                  ? yield* setupFingerprint(cwd, command).pipe(Effect.option)
                  : null;

              if (
                fingerprint !== null &&
                Option.isSome(fingerprint) &&
                previous?.fingerprint === fingerprint.value
              )
                return previous;

              const started = new WorktreeSetupRun({
                id: `${key}:setup:${crypto.randomUUID()}`,
                constellationId,
                taskId,
                command,
                cwd,
                fingerprint: null,
                status: "running",
                output: "",
                exitCode: null,
                startedAt: new Date().toISOString(),
                endedAt: null,
              });

              return yield* Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                  yield* record(sessionId, started);

                  const result = yield* restore(Effect.scoped(executeSetup(started))).pipe(
                    Effect.catch((error) =>
                      Effect.succeed(
                        new WorktreeSetupRun({
                          id: started.id,
                          constellationId,
                          taskId,
                          command,
                          cwd,
                          fingerprint: null,
                          startedAt: started.startedAt,
                          status: "failed",
                          output: error.message,
                          exitCode: null,
                          endedAt: new Date().toISOString(),
                        })
                      )
                    ),
                    Effect.onExit((exit) =>
                      Exit.isFailure(exit)
                        ? record(
                            sessionId,
                            new WorktreeSetupRun({
                              id: started.id,
                              constellationId,
                              taskId,
                              command,
                              cwd,
                              fingerprint: null,
                              startedAt: started.startedAt,
                              status: "failed",
                              output: Cause.pretty(exit.cause),
                              exitCode: null,
                              endedAt: new Date().toISOString(),
                            })
                          ).pipe(Effect.orDie)
                        : Effect.void
                    )
                  );

                  const finished =
                    result.status === "completed"
                      ? yield* setupFingerprint(cwd, command).pipe(
                          Effect.map(
                            (value) =>
                              new WorktreeSetupRun(Struct.assign(result, { fingerprint: value }))
                          ),
                          Effect.catch((error) =>
                            Effect.succeed(
                              new WorktreeSetupRun(
                                Struct.assign(result, {
                                  status: "failed" as const,
                                  fingerprint: null,
                                  exitCode: null,
                                  output: error.message,
                                })
                              )
                            )
                          )
                        )
                      : result;

                  yield* record(sessionId, finished);

                  return finished;
                })
              );
            })
          )
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                currentLock.users--;

                if (currentLock.users === 0) locks.delete(cwd);
              })
            )
          );
      });

      return { run };
    })
  );
}
