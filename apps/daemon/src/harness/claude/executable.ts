import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { win32 } from "node:path";
import { type Launch, launchOf } from "../../platform/cmdShim.ts";

type Executable = Pick<
  Options,
  "pathToClaudeCodeExecutable" | "executable" | "spawnClaudeCodeProcess"
>;

/** What the Agent SDK reads as a script it runs with `executable`, not a native binary. */
const SCRIPT = /\.(js|mjs)$/i;

const isNode = (program: string) => /^node(\.exe)?$/i.test(win32.basename(program));

/**
 * Starts the SDK's `node <script>` with the shim's own `node` by absolute path: a bare
 * `node` would resolve from the Workspace first on Windows, where a repo could plant one.
 * The SDK reads stderr only from its own spawns, so this one drains it.
 */
const spawnWith =
  (program: string): NonNullable<Options["spawnClaudeCodeProcess"]> =>
  ({ args, cwd, env, signal }) => {
    const child = spawn(program, args, { cwd, env, signal, stdio: "pipe", windowsHide: true });
    child.stderr.resume();

    return child;
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
