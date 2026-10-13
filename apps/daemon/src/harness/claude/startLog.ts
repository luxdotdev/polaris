/** The Claude driver's start lines after `query()`: ready on Claude Code's init, or why it exited first. */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Effect } from "effect";
import { logStart } from "../startLog.ts";

export const claudeStartLog = (sessionId: string, run: (log: Effect.Effect<void>) => void) => {
  let settled = false;

  return {
    onMessage: (message: SDKMessage) => {
      if (settled || message.type !== "system" || message.subtype !== "init") return;
      settled = true;
      const version = message.claude_code_version;
      run(logStart(sessionId, version ? `Claude Code ${version} ready` : "Claude Code ready"));
    },
    onExit: (error: string | null) => {
      if (!settled && error !== null)
        run(logStart(sessionId, `Claude Code exited before it was ready: ${error}`));
      settled = true;
    },
  };
};
