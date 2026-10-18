import { childEnv } from "../service/childEnv.ts";
import { constants } from "node:os";
import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { connectRpc } from "@polaris/client";
import { CommandId, SessionId } from "@polaris/protocol";
import { Effect, Predicate, Schedule } from "effect";
import { paths } from "../paths.ts";
import { localDaemonTransport } from "../transport/localDaemon.ts";
import { type LostExitOptions, processGone, watchLostExit } from "./lostExit.ts";
import { processIdentity } from "./process.ts";

/** The wrapper's code when the command's exit was never reported (ENG-357). */
export const LOST_EXIT_CODE = 1;

export interface LeaseChild {
  readonly pid: number;
  readonly exited: Promise<number>;
}

/**
 * The command's exit code, or LOST_EXIT_CODE once the process with `identity` is gone without
 * its exit being reported. The command may run for hours, so this checks every two seconds.
 */
export const leaseExit = (
  child: LeaseChild,
  identity: string,
  options: LostExitOptions = {}
): Promise<number> =>
  new Promise((resolve) => {
    const watch = watchLostExit(
      child.pid,
      () => {
        console.error("polaris lease: the command's exit status was lost");
        resolve(LOST_EXIT_CODE);
      },
      { intervalMs: 2000, gone: (pid) => processGone(pid, identity), ...options }
    );

    void child.exited.then((code) => {
      watch.stop();
      resolve(code);
    });
  });

const exitCodeOf = (child: Bun.Subprocess): number =>
  child.exitCode ?? (child.signalCode === null ? 1 : 128 + constants.signals[child.signalCode]);

const startGated = (name: string, command: ReadonlyArray<string>) =>
  Bun.spawn(["/bin/sh", "-c", 'read -r go <&3 && exec "$@"', "polaris-lease", ...command], {
    stdio: ["inherit", "inherit", "inherit", "pipe"],
    env: childEnv({
      ...process.env,
      POLARIS_LEASE_HELD: name,
      POLARIS_HOST_SOCKET: process.env.POLARIS_HOST_SOCKET ?? paths().socket,
    }),
  });

export const runLease = async (args: ReadonlyArray<string>): Promise<number> => {
  const [name, separator, ...command] = args;

  if (name === undefined || separator !== "--" || command.length === 0) {
    console.error("usage: polaris lease <name> -- <command> [args...]");

    return 2;
  }

  let child: ReturnType<typeof startGated>;

  try {
    child = startGated(name, command);
  } catch {
    return 127;
  }

  // The parent's end of fd 3. Bun owns and closes it, so an ungated shell is stopped by a kill.
  const gate = child.stdio[3];
  const pid = child.pid;
  let exited = child.exited.then(() => exitCodeOf(child));
  let stopped = false;

  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const requestId = randomUUID();

  let started = false;

  try {
    const identity = await processIdentity(pid);

    if (identity === null) return 127;
    exited = leaseExit({ pid, exited }, identity);
    console.error(`waiting on ${name}`);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* localDaemonTransport(
            process.env.POLARIS_HOST_SOCKET ?? paths().socket
          );

          const { client } = yield* connectRpc(transport);
          yield* client["host.resources.acquire"]({
            requestId,
            name,
            processId: pid,
            processIdentity: identity,
            command,
            sessionId:
              process.env.POLARIS_SESSION_ID === undefined
                ? null
                : SessionId.make(process.env.POLARIS_SESSION_ID),
          });

          if (gate !== null && gate !== undefined) writeSync(gate, "go\n");
          started = true;
          yield* Effect.promise(() => exited);
          yield* client["host.resources.release"]({
            commandId: CommandId.make(randomUUID()),
            leaseId: requestId,
          }).pipe(Effect.ignore);
        })
      ).pipe(
        Effect.retry({
          schedule: Schedule.spaced(250),
          while: (error) =>
            child.exitCode === null &&
            child.signalCode === null &&
            (Predicate.isTagged(error, "ConnectFailure") ||
              Predicate.isTagged(error, "RpcClientError")),
        })
      )
    );

    return await exited;
  } catch (error) {
    // An ungated shell is stopped; a running command keeps its lease until exit.
    if (!started) {
      stopped = true;
      child.kill("SIGTERM");
    }

    console.error(`polaris lease: ${String(error)}`);

    const code = await exited;

    return started || (code >= 128 && !stopped) ? code : 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
};
