/**
 * How the Daemon's own CLIs (`polaris constellation stats`, `polaris lease`, run by a Harness)
 * reach this Host's Daemon: its Unix socket, or on Windows its pipe once this user's
 * ownership is checked on the handle then used (ADR 0059).
 */
import {
  type ClientTransport,
  ConnectFailure,
  type Connector,
  socketTransport,
} from "@polaris/client";
import { readEvents, writeEvents } from "@polaris/protocol";
import { Effect } from "effect";

const ownPipeTransport = (path: string): Connector =>
  Effect.gen(function* () {
    const { connectOwnPipe, untrustedMessage } = yield* Effect.promise(
      () => import("./windowsPipe/client.ts")
    );

    const pipe = yield* Effect.acquireRelease(
      Effect.promise(() => connectOwnPipe(path)),
      (opened) => Effect.sync(() => (opened.kind === "connected" ? opened.stream.end() : undefined))
    );

    if (pipe.kind === "absent") {
      return yield* new ConnectFailure({
        kind: "needs-attention",
        reason: "daemon-not-running",
        detail: `nothing listening on ${path} (Win32 error ${pipe.code})`,
      });
    }

    if (pipe.kind === "untrusted") {
      return yield* new ConnectFailure({
        kind: "needs-attention",
        reason: "daemon-untrusted",
        detail: untrustedMessage(path, pipe),
      });
    }

    const stream = pipe.stream;

    return {
      incoming: readEvents(stream),
      write: writeEvents(stream),
      close: Effect.sync(() => stream.end()),
      diagnose: Effect.succeed(
        new ConnectFailure({
          kind: "transient",
          reason: "connection-lost",
          detail: `the Daemon closed ${path}`,
        })
      ),
    } satisfies ClientTransport;
  });

export const localDaemonTransport = (path: string): Connector =>
  process.platform === "win32" ? ownPipeTransport(path) : socketTransport(path);
