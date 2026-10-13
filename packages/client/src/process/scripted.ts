/**
 * `ChildProcess.test`: children that run nothing. Each answers from a script, with the
 * events and pipes in the order `node:child_process` gives them, so callers' own event
 * handling runs unchanged on any OS.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Predicate } from "effect";
import type { ChildProcessApi, SpawnRequest } from "./node.ts";

export interface ScriptedExit {
  readonly code?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stdout?: string | Uint8Array;
  readonly stderr?: string | Uint8Array;
}

export interface ScriptedProcess {
  /** The child never starts: its `error` event carries this errno code (`ENOENT`, `EACCES`). */
  readonly spawnError?: string;
  /** How it ends (after stdin closes, when piped). Default: exit 0. */
  readonly exit?: ScriptedExit;
  /** How it ends given what it read on stdin; wins over `exit`. */
  readonly afterStdin?: (stdin: Uint8Array) => ScriptedExit;
  /** Runs until killed. */
  readonly hang?: boolean;
}

const bytes = (chunks: ReadonlyArray<Uint8Array>) => new Uint8Array(Buffer.concat(chunks));

class ScriptedChild extends EventEmitter {
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdin: PassThrough | null;
  readonly stdout: PassThrough | null;
  readonly stderr: PassThrough | null;
  #ended = false;

  constructor(request: SpawnRequest) {
    super();
    const [stdin, stdout, stderr] = request.stdio ?? ["ignore", "pipe", "pipe"];
    this.stdin = stdin === "pipe" ? new PassThrough() : null;
    this.stdout = stdout === "pipe" ? new PassThrough() : null;
    this.stderr = stderr === "pipe" ? new PassThrough() : null;
  }

  end(code: number | null, signal: NodeJS.Signals | null) {
    if (this.#ended) return;
    this.#ended = true;
    this.exitCode = code;
    this.signalCode = signal;
    this.stdout?.end();
    this.stderr?.end();
    this.emit("exit", code, signal);
    setImmediate(() => this.emit("close", code, signal));
  }

  kill(signal?: NodeJS.Signals | number) {
    if (this.#ended) return false;
    setImmediate(() => this.end(null, Predicate.isString(signal) ? signal : "SIGTERM"));

    return true;
  }

  unref() {
    return this;
  }
}

const finish = (child: ScriptedChild, exit: ScriptedExit) => {
  if (exit.stdout !== undefined) child.stdout?.write(exit.stdout);

  if (exit.stderr !== undefined) child.stderr?.write(exit.stderr);
  child.end(
    exit.code ?? (exit.signal === undefined || exit.signal === null ? 0 : null),
    exit.signal ?? null
  );
};

const run = (child: ScriptedChild, scripted: ScriptedProcess) => {
  if (scripted.spawnError !== undefined) {
    const error: NodeJS.ErrnoException = new Error(`spawn ${scripted.spawnError}`);
    error.code = scripted.spawnError;
    child.emit("error", error);
    child.emit("close", -2, null);

    return;
  }

  child.emit("spawn");

  if (scripted.hang === true) return;

  const exit = (stdin: Uint8Array) => scripted.afterStdin?.(stdin) ?? scripted.exit ?? {};

  if (child.stdin === null) {
    finish(child, exit(new Uint8Array()));

    return;
  }

  const received: Array<Uint8Array> = [];
  child.stdin.on("data", (chunk: Uint8Array) => received.push(chunk));
  child.stdin.on("end", () => finish(child, exit(bytes(received))));
};

export const scriptedChildProcess = (
  script: (request: SpawnRequest) => ScriptedProcess
): ChildProcessApi => ({
  spawn: (request) => {
    const child = new ScriptedChild(request);
    setImmediate(() => run(child, script(request)));

    return child;
  },
});
