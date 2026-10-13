/**
 * `ChildProcess`: the one way the Client starts a helper (ssh, wsl.exe, a terminal, Squirrel's
 * Update.exe, the dev Daemon). It hides the console window a Windows GUI app would give each
 * child, classifies a child that never started, and stops one politely before forcing it.
 * Decisions: docs/adr/0045-platform-services.md.
 */
import { Context, Layer, Schema } from "effect";
import {
  type ChildProcessApi,
  childProcesses,
  type SpawnRequest,
  spawnErrorCode,
  spawnFailureReason,
} from "./node.ts";
import { type ScriptedProcess, scriptedChildProcess } from "./scripted.ts";

export * from "./node.ts";

export type { ScriptedExit, ScriptedProcess } from "./scripted.ts";

export const SpawnFailureReason = Schema.Literals(["missing", "denied", "failed"]);

export type SpawnFailureReason = typeof SpawnFailureReason.Type;

export class SpawnFailed extends Schema.TaggedError<SpawnFailed>()("SpawnFailed", {
  file: Schema.String,
  /** The errno code (`ENOENT`, `EACCES`, …), or the message when there is none. */
  code: Schema.String,
  reason: SpawnFailureReason,
  message: Schema.String,
}) {}

/** Classifies the `error` a child emits when it couldn't start. */
export const spawnFailed = (file: string, error: NodeJS.ErrnoException): SpawnFailed =>
  new SpawnFailed({
    file,
    code: spawnErrorCode(error),
    reason: spawnFailureReason(error),
    message: error.message,
  });

export class ChildProcess extends Context.Service<ChildProcess, ChildProcessApi>()(
  "polaris/client/ChildProcess"
) {
  static readonly node = Layer.succeed(ChildProcess, ChildProcess.of(childProcesses));

  /** Every spawn answered by `script`: exits, output and failures to start, nothing run. */
  static readonly test = (script: (request: SpawnRequest) => ScriptedProcess) =>
    Layer.succeed(ChildProcess, ChildProcess.of(scriptedChildProcess(script)));
}

export { scriptedChildProcess } from "./scripted.ts";
