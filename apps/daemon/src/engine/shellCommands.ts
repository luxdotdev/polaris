/**
 * `ShellCommands`: the user's shell commands (`RunShellCommand`) the Daemon runs for a
 * Turn before the Harness reads them. Each records one `CommandExecution` item of the
 * user's (`origin: "user"`), streamed as `ItemProgress`, and Interrupt stops it.
 */
import { DomainEvent, type SessionId, type TurnId, TurnItem } from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";
import type { ShellCommandRun } from "../harness/HarnessDriver.ts";
import { childEnv, repositoryEnv } from "../service/childEnv.ts";
import type { ServiceError } from "../services.ts";
import { LiveItem } from "../store/EventStore.ts";
import { terminalEnvironment } from "../terminal/environment.ts";
import { EngineRuntime, type Progress } from "./runtime.ts";
import { runShell, SHELL_TIMEOUT_MS, type ShellExit } from "./shellRun.ts";

/** How often streamed output may reach Clients while a command prints. */
const PROGRESS_INTERVAL_MS = 100;

/** A session's shell command, from the moment its Turn reaches the Harness until it is delivered. */
export interface ShellJob {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly controller: AbortController;
  /** Interrupt arrived: the Turn ends Interrupted and the Harness never reads it. */
  interrupted: boolean;
  /** Steers sent while it ran, for the Turn once the Harness has the command. */
  readonly steers: Array<string>;
}

/** The id of the user's command item in its Turn. */
export const shellItemId = (turnId: TurnId) => `shell:${turnId}`;

const failureOf = (exit: ShellExit): string | null => {
  if (exit.ending === "timed-out") return `timed out after ${SHELL_TIMEOUT_MS / 60_000} minutes`;

  return exit.ending === "not-started" ? (exit.error ?? "it couldn't start") : null;
};

/** What the user sees under the command: its output, then why it stopped short. */
const shownOutput = (exit: ShellExit, failure: string | null) =>
  failure === null ? exit.output : [exit.output.trimEnd(), `Command ${failure}`].join("\n").trim();

const commandItem = (
  turnId: TurnId,
  fields: { command: string; cwd: string; startedAt: string; output: string },
  end: { exitCode: number | null; status: "running" | "completed" | "failed" }
) =>
  TurnItem.cases.CommandExecution.make({
    id: shellItemId(turnId),
    ...fields,
    ...end,
    origin: "user",
  });

const make = Effect.gen(function* () {
  const rt = yield* EngineRuntime;
  const jobs = new Map<SessionId, ShellJob>();

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const job of jobs.values()) job.controller.abort();
    })
  );

  const begin = (sessionId: SessionId, turnId: TurnId): ShellJob => {
    const job: ShellJob = {
      sessionId,
      turnId,
      controller: new AbortController(),
      interrupted: false,
      steers: [],
    };

    jobs.get(sessionId)?.controller.abort();
    jobs.set(sessionId, job);

    return job;
  };

  const progress = (job: ShellJob, item: TurnItem) => {
    const items = rt.progress.get(job.sessionId) ?? new Map<string, Progress>();

    items.set(item.id, { turnId: job.turnId, item, subagentId: null });
    rt.progress.set(job.sessionId, items);
    Effect.runSync(
      rt.store.publishEphemeral(
        LiveItem.ItemProgress({
          sessionId: job.sessionId,
          turnId: job.turnId,
          item,
          subagentId: null,
        })
      )
    );
  };

  const run = (
    job: ShellJob,
    command: string
  ): Effect.Effect<ShellCommandRun | null, ServiceError> =>
    Effect.gen(function* () {
      const model = yield* rt.store.model;
      const cwd = model.sessions.get(job.sessionId)?.session.cwd ?? process.cwd();

      const env = terminalEnvironment(model, cwd) === "repository" ? repositoryEnv() : childEnv();

      const fields = { command, cwd, startedAt: yield* rt.now, output: "" };
      const running = { exitCode: null, status: "running" } as const;
      let shownAt = 0;

      progress(job, commandItem(job.turnId, fields, running));

      const exit = yield* Effect.promise(() =>
        runShell({
          command,
          cwd,
          env,
          signal: job.controller.signal,
          onOutput: (output) => {
            if (Date.now() - shownAt < PROGRESS_INTERVAL_MS) return;
            shownAt = Date.now();
            progress(job, commandItem(job.turnId, { ...fields, output }, running));
          },
        })
      );

      const failure = failureOf(exit);
      const ok = exit.ending === "exited" && exit.exitCode === 0;

      const item = commandItem(
        job.turnId,
        { ...fields, output: shownOutput(exit, failure) },
        { exitCode: exit.exitCode, status: ok ? "completed" : "failed" }
      );

      rt.progress.get(job.sessionId)?.delete(item.id);
      yield* rt.recordFor(job.sessionId, () => [
        DomainEvent.cases.TurnItemCompleted.make({
          sessionId: job.sessionId,
          turnId: job.turnId,
          item,
          subagentId: null,
        }),
      ]);

      if (exit.ending === "interrupted") return null;

      return {
        command,
        stdout: exit.stdout,
        stderr: exit.stderr,
        exitCode: exit.exitCode,
        failure,
      };
    });

  const end = (job: ShellJob) => {
    if (jobs.get(job.sessionId) === job) jobs.delete(job.sessionId);
  };

  const interrupt = (sessionId: SessionId) =>
    Effect.sync(() => {
      const job = jobs.get(sessionId);

      if (job === undefined) return false;
      job.interrupted = true;
      job.controller.abort();

      return true;
    });

  const holdSteer = (sessionId: SessionId, text: string) =>
    Effect.sync(() => {
      const job = jobs.get(sessionId);

      if (job === undefined) return false;
      job.steers.push(text);

      return true;
    });

  return ShellCommands.of({ begin, run, end, interrupt, holdSteer });
});

export class ShellCommands extends Context.Service<
  ShellCommands,
  {
    /** The session's command from now until `end`; Interrupt and steers reach it from here. */
    readonly begin: (sessionId: SessionId, turnId: TurnId) => ShellJob;
    /** Runs it in the session's directory, recording the user's item; null when interrupted. */
    readonly run: (
      job: ShellJob,
      command: string
    ) => Effect.Effect<ShellCommandRun | null, ServiceError>;
    /** The Harness has it (or the Turn ended): Interrupt and steers go to the Harness again. */
    readonly end: (job: ShellJob) => void;
    /** Stop the session's command, if one runs or waits to be delivered. */
    readonly interrupt: (sessionId: SessionId) => Effect.Effect<boolean>;
    /** Keep a steer for the Turn until the Harness has the command; false when none runs. */
    readonly holdSteer: (sessionId: SessionId, text: string) => Effect.Effect<boolean>;
  }
>()("polaris/daemon/engine/ShellCommands") {
  static readonly layer = Layer.effect(ShellCommands, make);
}
