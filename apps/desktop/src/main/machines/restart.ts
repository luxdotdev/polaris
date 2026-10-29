/**
 * Restart daemon for `Machines`: runs the Client's `restartDaemon` over the Host's channel
 * and turns its outcome into what the renderer shows (shared/restart.ts). `Machines` picks
 * the channel and the connection; this does the rest.
 */
import type { HostChannel } from "@polaris/client/access";
import type { ChildProcessApi } from "@polaris/client/process";
import {
  restartDaemon,
  restartPreview,
  type RestartOptions,
  type RestartRunner,
  shellRunner,
} from "@polaris/client/restart";
import { Effect, Match, SubscriptionRef } from "effect";
import type { RestartDaemonResult, RestartPreviewView } from "../../shared/restart.ts";
import { runInstalled } from "./windowsLocal.ts";

export interface RestartTarget {
  readonly name: string;
  readonly channel: HostChannel;
  readonly connection: RestartOptions["connection"];
  /** A Windows SSH Host (its DefaultShell runs the logon task's line). */
  readonly windowsShell: boolean;
  readonly platform: NodeJS.Platform;
  readonly processes?: ChildProcessApi | undefined;
}

/** This machine's own Daemon is the exception: it restarts even when it doesn't answer. */
const isLocal = (target: RestartTarget) => target.channel.kind === "local";

const runnerFor = (target: RestartTarget): RestartRunner => {
  const home = target.channel.home;

  return isLocal(target) && target.platform === "win32" && home !== null
    ? { kind: "windows-local", runInstalled: (args) => runInstalled(home, args, target.processes) }
    : shellRunner(target.channel, target.windowsShell);
};

export const restartOver = (target: RestartTarget): Effect.Effect<RestartDaemonResult> =>
  restartDaemon({
    name: target.name,
    local: isLocal(target),
    connection: target.connection,
    runner: runnerFor(target),
  }).pipe(
    Effect.map((outcome): RestartDaemonResult => ({ outcome: "back", ...outcome })),
    Effect.catch((error) =>
      Effect.succeed(
        Match.value(error).pipe(
          Match.tagsExhaustive({
            RestartRefused: ({ message }): RestartDaemonResult => ({ outcome: "refused", message }),
            RestartFailed: (failed): RestartDaemonResult => ({
              outcome: "failed",
              stage: failed.stage,
              message: failed.message,
              manager: failed.manager,
              command: failed.command,
              output: failed.output,
              exitCode: failed.exitCode,
              reinstall: failed.reinstall,
            }),
            TaskConflict: ({ task, otherHome, message }): RestartDaemonResult => ({
              outcome: "task-conflict",
              task,
              otherHome,
              message,
            }),
          })
        )
      )
    )
  );

export const previewOver = (target: RestartTarget): Effect.Effect<RestartPreviewView> =>
  Effect.gen(function* () {
    const status = yield* SubscriptionRef.get(target.connection.status);
    const available = isLocal(target) || status.state === "connected";
    const preview = yield* restartPreview(target.connection);

    return {
      available,
      unavailableReason: available ? null : `Restarts once ${target.name} is connected`,
      interrupts:
        preview === null
          ? null
          : {
              workingSessions: preview.workingSessions.map((s) => ({
                sessionId: s.sessionId,
                title: s.title,
                harness: s.harness,
                turn: s.turn,
              })),
              terminals: preview.terminals,
              pendingApprovals: preview.pendingApprovals,
            },
    };
  });
