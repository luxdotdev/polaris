/**
 * Byte transports a Client connects over: a child process's stdio (normally
 * `ssh <alias> polaris bridge`) or the local Daemon's Unix socket.
 *
 * Each transport can explain, after it failed, why: `diagnose` classifies the
 * exit status and stderr into a ConnectFailure the Connection State uses.
 */
import { spawn } from "node:child_process";
import { connect, type Socket } from "node:net";
import { type ByteTransport, readEvents, writeEvents } from "@polaris/protocol";
import { Deferred, Effect, Exit, Option, type Scope } from "effect";
import { ConnectFailure, classifyExit, type NeedsAttentionReason } from "./failures.ts";
import { localDaemonFailure } from "./localDaemon.ts";

export interface ClientTransport extends ByteTransport {
  /** Why the transport closed or failed; waits briefly for the process to exit. */
  readonly diagnose: Effect.Effect<ConnectFailure>;
}

/** How a HostConnection opens its transport. Injectable, so tests can replace `ssh`. */
export type Connector = Effect.Effect<ClientTransport, ConnectFailure, Scope.Scope>;

const STDERR_LIMIT = 16 * 1024;

const decoder = new TextDecoder();

export interface SpawnOptions {
  readonly env?: Record<string, string | undefined>;
  /** Grace period after stdin closes before the process is killed. */
  readonly killAfterMs?: number;
  /** Decodes stderr chunks; UTF-8 by default (wsl.exe mixes in UTF-16LE). */
  readonly stderrDecoder?: () => (chunk: Uint8Array) => string;
  /** Classifies the exit; `classifyExit` (ssh's messages) by default. */
  readonly classify?: (exit: {
    readonly code: number | null;
    readonly signal: string | null;
    readonly stderr: string;
  }) => ConnectFailure;
  /** The reason when the command itself can't be spawned; default by the command's name. */
  readonly spawnFailureReason?: NeedsAttentionReason;
}

/** Runs `argv` and speaks the wire over its stdin/stdout. */
export const spawnTransport = (
  argv: ReadonlyArray<string>,
  options: SpawnOptions = {}
): Connector =>
  Effect.gen(function* () {
    const [command, ...args] = argv;

    if (command === undefined) {
      return yield* new ConnectFailure({
        kind: "needs-attention",
        reason: "command-missing",
        detail: "empty command",
      });
    }

    const exited = yield* Deferred.make<{ code: number | null; signal: string | null }>();
    const decode = options.stderrDecoder?.() ?? ((chunk: Uint8Array) => decoder.decode(chunk));
    const classify = options.classify ?? classifyExit;
    let stderr = "";
    let spawnError: NodeJS.ErrnoException | null = null;
    // Set from the child's `error` event; read through a call so TypeScript doesn't narrow it.
    const startError = () => spawnError;

    const { child, incoming } = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const child = spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: options.env ?? process.env,
        });

        child.on("error", (error: NodeJS.ErrnoException) => {
          spawnError = error;
          Deferred.doneUnsafe(exited, Exit.succeed({ code: null, signal: null }));
        });
        // `exit`, not `close`: an SSH ControlPersist master may keep stderr open for minutes.
        child.on("exit", (code, signal) =>
          Deferred.doneUnsafe(exited, Exit.succeed({ code, signal }))
        );
        child.stderr?.on("data", (chunk: Uint8Array) => {
          stderr = (stderr + decode(chunk)).slice(-STDERR_LIMIT);
        });
        child.stdin?.on("error", () => {});

        // Attach the reader now, before any output can arrive.
        const incoming = child.stdout === null ? null : readEvents(child.stdout);

        return { child, incoming };
      }),
      ({ child }) =>
        Effect.gen(function* () {
          child.stdin?.end();

          const done = yield* Deferred.await(exited).pipe(
            Effect.timeoutOption(options.killAfterMs ?? 2000)
          );

          if (Option.isNone(done)) child.kill("SIGTERM");
          child.stderr?.destroy();
          child.stdout?.destroy();
        })
    );

    const stdin = child.stdin;

    if (stdin === null || incoming === null) {
      return yield* new ConnectFailure({
        kind: "transient",
        reason: "spawn-failed",
        detail: "no stdio pipes",
      });
    }

    const missingReason =
      options.spawnFailureReason ?? (command === "ssh" ? "ssh-missing" : "command-missing");

    // A spawn failure arrives on the next tick; wait for it so the attempt fails outright.
    yield* Effect.callback<void>((resume) => {
      setImmediate(() => resume(Effect.void));
    });

    const notStarted = startError();

    if (notStarted !== null) {
      return yield* new ConnectFailure({
        kind: "needs-attention",
        reason: missingReason,
        detail: `${command}: ${notStarted.code ?? notStarted.message}`,
      });
    }

    const diagnose = Deferred.await(exited).pipe(
      Effect.timeoutOption(3000),
      Effect.map((exit) => {
        const failed = startError();

        return failed !== null
          ? new ConnectFailure({
              kind: "needs-attention",
              reason: missingReason,
              detail: `${command}: ${failed.code ?? failed.message}`,
            })
          : classify({
              code: Option.isSome(exit) ? exit.value.code : null,
              signal: Option.isSome(exit) ? exit.value.signal : null,
              stderr,
            });
      })
    );

    return {
      incoming,
      write: writeEvents(stdin),
      close: Effect.sync(() => {
        stdin.end();
      }),
      diagnose,
    } satisfies ClientTransport;
  });

/**
 * Connects straight to a Daemon's Unix socket (the local Host). With
 * `installedHome`, a refusal says whether a Daemon is installed there and what its log says.
 */
export const socketTransport = (path: string, installedHome?: string): Connector =>
  Effect.gen(function* () {
    const { socket, incoming } = yield* Effect.acquireRelease(
      Effect.callback<
        { readonly socket: Socket; readonly incoming: ByteTransport["incoming"] },
        ConnectFailure
      >((resume) => {
        const socket = connect(path);

        const onError = (error: NodeJS.ErrnoException) =>
          resume(
            Effect.fail(
              error.code === "ENOENT" || error.code === "ECONNREFUSED"
                ? localDaemonFailure(path, installedHome)
                : new ConnectFailure({
                    kind: "transient",
                    reason: "connection-failed",
                    detail: `${path}: ${error.code ?? error.message}`,
                  })
            )
          );

        socket.once("error", onError);
        socket.once("connect", () => {
          socket.off("error", onError);
          socket.on("error", () => {});
          resume(Effect.succeed({ socket, incoming: readEvents(socket) }));
        });
      }),
      ({ socket }) => Effect.sync(() => socket.destroy())
    );

    return {
      incoming,
      write: writeEvents(socket),
      close: Effect.sync(() => {
        socket.end();
      }),
      diagnose: Effect.succeed(
        new ConnectFailure({
          kind: "transient",
          reason: "connection-lost",
          detail: `the Daemon closed ${path}`,
        })
      ),
    } satisfies ClientTransport;
  });
