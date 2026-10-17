import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { win32 } from "node:path";
import { type Launch, launchOf } from "../../platform/cmdShim.ts";

type Executable = Pick<Options, "pathToClaudeCodeExecutable" | "executable">;

/** What the Agent SDK reads as a script it runs with `executable`, not a native binary. */
const SCRIPT = /\.(js|mjs)$/i;

const isNode = (program: string) => /^node(\.exe)?$/i.test(win32.basename(program));

/**
 * The Agent SDK's options that start `claudePath`. The SDK spawns through node's
 * `child_process`, which won't start a `.cmd` at all, so npm's `claude.cmd` is run by its
 * target: `claude.exe`, or `cli.js` under the `node` on PATH.
 */
export const claudeExecutable = (
  claudePath: string,
  launch: Launch = launchOf(claudePath)
): Executable => {
  const [script, ...rest] = launch.args;

  if (script === undefined) return { pathToClaudeCodeExecutable: launch.program };

  return rest.length === 0 && SCRIPT.test(script) && isNode(launch.program)
    ? { pathToClaudeCodeExecutable: script, executable: "node" }
    : { pathToClaudeCodeExecutable: claudePath };
};
