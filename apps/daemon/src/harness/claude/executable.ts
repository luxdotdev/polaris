import type { Options } from "@anthropic-ai/claude-agent-sdk";
import {
  type ChildProcessWithoutNullStreams,
  spawn,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { win32 } from "node:path";
import { type Launch, launchOf } from "../../platform/cmdShim.ts";
import { executableOf } from "../../platform/executable.ts";
import { guardExit } from "../../resources/lostExit.ts";

type Executable = Pick<
  Options,
  "pathToClaudeCodeExecutable" | "executable" | "spawnClaudeCodeProcess"
>;

/** How the SDK's child is started; a test passes one whose exit never comes. */
export type Start = (
  file: string,
  args: ReadonlyArray<string>,
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

/** What the Agent SDK reads as a script it runs with `executable`, not a native binary. */
const SCRIPT = /\.(js|mjs)$/i;

const isNode = (program: string) => /^node(\.exe)?$/i.test(win32.basename(program));

/**
 * Starts the SDK's `node <script>` with the shim's own `node` by absolute path: a bare
 * `node` would resolve from the Workspace first on Windows, where a repo could plant one.
 * The SDK reads stderr only from its own spawns, so this one drains it. The SDK awaits the
 * child's exit, which Bun can lose (ENG-357), so a child gone after its stdout closed exits.
 */
export const spawnWith =
  (program: string, start: Start = spawn): NonNullable<Options["spawnClaudeCodeProcess"]> =>
  ({ args, cwd, env, signal }) => {
    const options = { cwd, env, signal, stdio: "pipe", windowsHide: true } as const;
    const child = start(executableOf(program), args, options);
    child.stderr.resume();

    return guardExit(child);
  };

/**
 * The Agent SDK's options that start `claudePath`. The SDK spawns through node's
 * `child_process`, which won't start a `.cmd` at all, so npm's `claude.cmd` is run by its
 * target: `claude.exe`, or `cli.js` under the absolute `node` the shim names.
 */
export const claudeExecutable = (
  claudePath: string,
  launch: Launch = launchOf(claudePath)
): Executable => {
  const [script, ...rest] = launch.args;

  if (script === undefined) return { pathToClaudeCodeExecutable: launch.program };

  return rest.length === 0 &&
    SCRIPT.test(script) &&
    isNode(launch.program) &&
    win32.isAbsolute(launch.program)
    ? {
        pathToClaudeCodeExecutable: script,
        executable: "node",
        spawnClaudeCodeProcess: spawnWith(launch.program),
      }
    : { pathToClaudeCodeExecutable: claudePath };
};
