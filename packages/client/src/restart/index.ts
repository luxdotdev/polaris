/**
 * Restart daemon: the Client restarts a Host's Daemon through the Host's own service
 * manager, over the channel it already uses there (ssh, wsl.exe, a local shell; this PC's
 * `polaris.exe` on a Windows Client). Claude's Turns end cleanly first (`host.prepareRestart`);
 * the Connection State then moves through the machine as for any dropped connection.
 * See docs/adr/0087-restart-runs-from-the-client-through-the-service-manager.md.
 */
import type { RestartPreview } from "@polaris/protocol";
import {
  Duration,
  Effect,
  Option,
  Predicate,
  Schedule,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import type { HostChannel, HostKind } from "../access/index.ts";
import type { ConnectionStatus, HostConnection } from "../HostConnection.ts";
import { TaskConflict, taskConflictOf } from "../install/apply.ts";
import { type SshError, type SshResult, shScript } from "../install/Ssh.ts";
import { stripClixml } from "../install/windows/powershell.ts";
import {
  DaemonService,
  missingService,
  parseServiceProbe,
  type RestartCommand,
  restartCommandFor,
  SERVICE_PROBE,
  ServiceManager,
} from "./service.ts";

export * from "./service.ts";

export { TaskConflict };

/** A remote Host restarts only while connected; this machine's own Daemon always may. */
export class RestartRefused extends Schema.TaggedError<RestartRefused>()("RestartRefused", {
  reason: Schema.Literals(["not-connected"]),
  message: Schema.String,
}) {}

/**
 * The restart didn't happen, or the Daemon didn't come back. `stage`: `channel` (the Host
 * couldn't be reached to run anything), `no-service` (no service holds the Daemon), `service`
 * (the service manager refused), `start` (it ran, but no new Daemon answered in time).
 */
export class RestartFailed extends Schema.TaggedError<RestartFailed>()("RestartFailed", {
  stage: Schema.Literals(["channel", "no-service", "service", "start"]),
  message: Schema.String,
  manager: Schema.NullOr(ServiceManager),
  /** The exact command, for "Copy command"; null when nothing was run. */
  command: Schema.NullOr(Schema.String),
  /** The service manager's own stderr (or stdout), as it printed it. */
  output: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  /** "Reinstall service" applies: no service holds the Daemon, or it never came back. */
  reinstall: Schema.Boolean,
}) {}

export type RestartError = RestartRefused | RestartFailed | TaskConflict;

/** How restart commands reach the Host. */
export type RestartRunner =
  | {
      readonly kind: "shell";
      readonly via: HostKind;
      /** Set for a Windows SSH Host: its DefaultShell runs the logon task's line. */
      readonly windows: boolean;
      readonly exec: (line: string) => Effect.Effect<SshResult, SshError>;
    }
  /** A Windows Client's own Daemon: runs the installed `polaris.exe` with these arguments. */
  | {
      readonly kind: "windows-local";
      readonly runInstalled: (args: ReadonlyArray<string>) => Effect.Effect<SshResult, SshError>;
    };

/** A Host channel as a runner; `windows` when the Host is a Windows SSH Host. */
export const shellRunner = (
  channel: Pick<HostChannel, "kind" | "exec">,
  windows: boolean
): RestartRunner => ({
  kind: "shell",
  via: channel.kind,
  windows,
  exec: (line) => channel.exec(line),
});

export interface RestartOptions {
  /** For messages: "Mac Studio". */
  readonly name: string;
  /** This machine's own Daemon: restarts even when it doesn't answer. */
  readonly local: boolean;
  readonly connection: Pick<HostConnection, "status" | "changes" | "session" | "retryNow">;
  readonly runner: RestartRunner;
  /** How long a new Daemon has to answer after the service manager ran; default 60 s. */
  readonly backTimeout?: Duration.Input;
  /** How long `host.prepareRestart` may take; default 30 s. */
  readonly prepareTimeout?: Duration.Input;
  /** How often a Host waiting on Needs Attention or Offline retries meanwhile; default 1 s. */
  readonly retryEvery?: Duration.Input;
}

export interface RestartOutcome {
  readonly manager: ServiceManager;
  readonly command: string;
  /** The Daemon's `startedAt` before and after; `before` is null if it never answered. */
  readonly previousStartedAt: string | null;
  readonly startedAt: string;
  /** Turns `host.prepareRestart` ended; null when it couldn't run (not connected, older Daemon). */
  readonly interruptedTurns: number | null;
}

const outputOf = (result: SshResult) => stripClixml(result.stderr || result.stdout).trim();

const channelFailed = (error: SshError, command: RestartCommand | null) =>
  new RestartFailed({
    stage: "channel",
    message: error.message,
    manager: command?.manager ?? null,
    command: command?.display ?? null,
    output: error.message,
    exitCode: null,
    reinstall: false,
  });

/** Ends in-process Turns on a connected Daemon that offers it; null when it can't. */
const prepare = (options: RestartOptions, status: ConnectionStatus) =>
  status.state !== "connected" || !status.capabilities.includes("host.restart")
    ? Effect.succeed(null)
    : options.connection.session.pipe(
        Effect.flatMap((session) => session.client["host.prepareRestart"]({})),
        Effect.map(({ interruptedTurns }) => interruptedTurns),
        Effect.timeout(options.prepareTimeout ?? Duration.seconds(30)),
        // Restart recovery (ADR 0004) still ends the Turns; a failed prepare doesn't block.
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning("preparing for the restart failed", cause), null)
        )
      );

/** Which service holds the Daemon, from the probe; Windows is always the logon task. */
const findService = (runner: RestartRunner) => {
  if (runner.kind === "windows-local" || runner.windows)
    return Effect.succeed(DaemonService.TaskScheduler());

  return runner.exec(shScript(SERVICE_PROBE)).pipe(
    Effect.mapError((error) => channelFailed(error, null)),
    Effect.flatMap((result) => {
      const found = result.code === 0 ? parseServiceProbe(result.stdout) : null;

      return found === null
        ? Effect.fail(
            new RestartFailed({
              stage: "no-service",
              message: "no service runs the daemon on this host",
              manager: null,
              command: null,
              output: outputOf(result),
              exitCode: result.code,
              reinstall: true,
            })
          )
        : Effect.succeed(found);
    })
  );
};

const decodeReport = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

/** Runs the restart command; fails with what the service manager said. */
const runCommand = (options: RestartOptions, command: RestartCommand) =>
  Effect.gen(function* () {
    const { runner } = options;

    const result = yield* (
      runner.kind === "windows-local"
        ? runner.runInstalled(["install", "--restart", "--json"])
        : runner.exec(command.line)
    ).pipe(Effect.mapError((error) => channelFailed(error, command)));

    const output = outputOf(result);

    if (command.manager === "task-scheduler") {
      const report = Option.getOrNull(decodeReport(result.stdout.trim().split("\n").at(-1) ?? ""));
      const conflict = taskConflictOf(report, { alias: options.name, step: "restart" });

      if (conflict !== null) return yield* conflict;

      if (result.code === 0 && report?.ok === true) return;

      const message = Predicate.isString(report?.message) ? report.message : output;

      return yield* serviceFailed(command, message, result.code, false);
    }

    if (result.code === 0) return;

    return yield* serviceFailed(
      command,
      output,
      result.code,
      missingService(command.manager, output, result.code)
    );
  });

const serviceFailed = (
  command: RestartCommand,
  output: string,
  exitCode: number,
  reinstall: boolean
) =>
  new RestartFailed({
    stage: "service",
    message: `${command.manager} couldn't restart the daemon (exit ${exitCode})`,
    manager: command.manager,
    command: command.display,
    output,
    exitCode,
    reinstall,
  });

/** Waits for a Daemon other than `previous` to answer: the machine's Connected again. */
const awaitBack = (options: RestartOptions, command: RestartCommand, previous: string | null) =>
  options.connection.changes.pipe(
    Stream.filter(
      (status) =>
        status.state === "connected" && status.host !== null && status.host.startedAt !== previous
    ),
    Stream.runHead,
    Effect.flatMap((found) =>
      Option.isSome(found) && found.value.host !== null
        ? Effect.succeed(found.value.host.startedAt)
        : Effect.die("the connection's changes ended")
    ),
    Effect.timeoutOrElse({
      duration: options.backTimeout ?? Duration.seconds(60),
      orElse: () =>
        Effect.flatMap(SubscriptionRef.get(options.connection.status), (status) =>
          Effect.fail(
            new RestartFailed({
              stage: "start",
              message: `the daemon on ${options.name} didn't come back`,
              manager: command.manager,
              command: command.display,
              output: status.failure?.detail ?? "",
              exitCode: null,
              reinstall: true,
            })
          )
        ),
    })
  );

/**
 * Restart the Host's Daemon: refuse a remote Host that isn't connected, end Claude's Turns,
 * run the service manager's restart, then wait for a new Daemon (a new `startedAt`).
 */
export const restartDaemon = Effect.fn("restartDaemon")(function* (options: RestartOptions) {
  const status = yield* SubscriptionRef.get(options.connection.status);

  if (!options.local && status.state !== "connected") {
    return yield* new RestartRefused({
      reason: "not-connected",
      message: `Restarts once ${options.name} is connected`,
    });
  }

  const previousStartedAt = status.host?.startedAt ?? null;
  const interruptedTurns = yield* prepare(options, status);
  const command = restartCommandFor(yield* findService(options.runner));
  yield* runCommand(options, command);

  // While it waits on Needs Attention or Offline, the Host retries now and again, not on its timer.
  const nudge = Effect.flatMap(SubscriptionRef.get(options.connection.status), (now) =>
    now.state === "needs-attention" || now.state === "offline"
      ? options.connection.retryNow
      : Effect.void
  ).pipe(Effect.repeat(Schedule.spaced(options.retryEvery ?? Duration.seconds(1))));

  const startedAt = yield* Effect.raceFirst(
    awaitBack(options, command, previousStartedAt),
    Effect.andThen(nudge, Effect.never)
  );

  return {
    manager: command.manager,
    command: command.display,
    previousStartedAt,
    startedAt,
    interruptedTurns,
  } satisfies RestartOutcome;
});

/** The confirm's preview from a connected Daemon that offers it; null otherwise. */
export const restartPreview = (connection: Pick<HostConnection, "status" | "session">) =>
  Effect.gen(function* () {
    const status = yield* SubscriptionRef.get(connection.status);

    if (status.state !== "connected" || !status.capabilities.includes("host.restart")) return null;

    return yield* connection.session.pipe(
      Effect.flatMap((session) => session.client["host.restartPreview"]({})),
      Effect.map((preview): RestartPreview | null => preview),
      Effect.catchCause((cause) =>
        Effect.as(Effect.logWarning("reading the restart preview failed", cause), null)
      )
    );
  });
