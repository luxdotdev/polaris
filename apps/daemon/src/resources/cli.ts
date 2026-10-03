import { childEnv } from "../service/childEnv.ts";
import { constants } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { connectRpc, socketTransport } from "@polaris/client";
import { CommandId, SessionId } from "@polaris/protocol";
import { Effect, Predicate, Schedule } from "effect";
import { paths } from "../paths.ts";
import { processIdentity } from "./process.ts";

export const runLease = async (args: ReadonlyArray<string>): Promise<number> => {
  const [name, separator, ...command] = args;

  if (name === undefined || separator !== "--" || command.length === 0) {
    console.error("usage: polaris lease <name> -- <command> [args...]");

    return 2;
  }

  const child = spawn(
    "/bin/sh",
    ["-c", 'read -r go <&3 && exec "$@"', "polaris-lease", ...command],
    {
      stdio: ["inherit", "inherit", "inherit", "pipe"],
      env: childEnv({
        ...process.env,
        POLARIS_LEASE_HELD: name,
        POLARIS_HOST_SOCKET: process.env.POLARIS_HOST_SOCKET ?? paths().socket,
      }),
    }
  );

  // SAFETY: stdio[3] is the writable pipe requested in spawn's stdio tuple.
  const gate = child.stdio[3] as Writable;
  gate.on("error", () => {});

  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code, signal) =>
      resolve(code ?? (signal === null ? 1 : 128 + constants.signals[signal]))
    );
    child.on("error", () => resolve(127));
  });

  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const requestId = randomUUID();

  let started = false;

  try {
    const pid = child.pid;

    if (pid === undefined) return 127;
    const identity = await processIdentity(pid);

    if (identity === null) return 127;
    console.error(`waiting on ${name}`);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* socketTransport(
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
          gate.end("go\n");
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
    // Closing an unopened gate stops the child; a running command keeps its lease until exit.
    gate.end();
    console.error(`polaris lease: ${String(error)}`);

    const code = await exited;

    return started || code >= 128 ? code : 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
};
