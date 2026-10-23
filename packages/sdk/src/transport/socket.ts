/**
 * The local transport (Node and Bun only): the Daemon's Unix socket, at
 * `$POLARIS_HOME/daemon.sock` (`~/.polaris/daemon.sock` by default).
 */
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ByteTransport, readEvents, writeEvents } from "@polaris/protocol";
import { Effect, type Scope } from "effect";
import { HostUnreachable } from "../errors.ts";

export const defaultSocketPath = (): string =>
  join(process.env.POLARIS_HOME ?? join(homedir(), ".polaris"), "daemon.sock");

const opened = (path: string, hostId: string) =>
  Effect.callback<ReturnType<typeof connect>, HostUnreachable>((resume) => {
    const socket = connect(path);

    const onError = (error: NodeJS.ErrnoException) =>
      resume(
        Effect.fail(
          new HostUnreachable({
            hostId,
            detail:
              error.code === "ENOENT" || error.code === "ECONNREFUSED"
                ? `no Daemon is listening on ${path}`
                : `${path}: ${error.code ?? error.message}`,
          })
        )
      );

    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      // Errors after connecting end the stream through `readEvents`.
      socket.on("error", () => {});
      resume(Effect.succeed(socket));
    });

    return Effect.sync(() => socket.destroy());
  });

/** Connects to the local Daemon's socket for `hostId`; it closes with the scope. */
export const socketTransport = (
  path: string,
  hostId: string
): Effect.Effect<ByteTransport, HostUnreachable, Scope.Scope> =>
  Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(opened(path, hostId), (socket) =>
      Effect.sync(() => socket.destroy())
    );

    return {
      incoming: readEvents(socket),
      write: writeEvents(socket),
      close: Effect.sync(() => {
        socket.end();
      }),
    } satisfies ByteTransport;
  });
