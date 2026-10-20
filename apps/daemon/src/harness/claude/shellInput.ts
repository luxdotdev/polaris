/**
 * The user's shell command as Claude Code's own bash mode hands it to the model: the
 * command in `<bash-input>`, then what it printed in `<bash-stdout>` and `<bash-stderr>`
 * (or `Command failed: …`), delivered as written (`client_composed`).
 */
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ShellCommandRun } from "../HarnessDriver.ts";

/** stderr, then what the model can't see in it: a non-zero exit, a timeout. */
const stderrOf = (run: ShellCommandRun) =>
  [
    run.stderr.trimEnd(),
    run.exitCode !== null && run.exitCode !== 0 ? `Exit code ${run.exitCode}` : "",
    run.failure === null ? "" : `Command ${run.failure}`,
  ]
    .filter((part) => part !== "")
    .join("\n");

/** What the command printed, as the second block of the message. */
export const shellOutputText = (run: ShellCommandRun): string =>
  run.failure !== null && run.stdout === "" && run.stderr === ""
    ? `<bash-stderr>Command failed: ${run.failure}</bash-stderr>`
    : `<bash-stdout>${run.stdout.trimEnd()}</bash-stdout><bash-stderr>${stderrOf(run)}</bash-stderr>`;

export const shellCommandMessage = (
  uuid: NonNullable<SDKUserMessage["uuid"]>,
  run: ShellCommandRun
): SDKUserMessage => ({
  type: "user",
  message: {
    role: "user",
    content: [
      { type: "text", text: `<bash-input>${run.command}</bash-input>` },
      { type: "text", text: shellOutputText(run) },
    ],
  },
  parent_tool_use_id: null,
  uuid,
  origin: { kind: "human" },
  // No `@path` expansion or slash dispatch: the output is delivered as it was printed.
  client_composed: true,
});
