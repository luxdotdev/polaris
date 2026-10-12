/**
 * Claude's own word that a Turn stopped at a usage limit: a `rate_limit_event` whose
 * status is `rejected` (with its reset), or an assistant message with `error: "rate_limit"`.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { isoFromEpochSeconds } from "../limits/claude.ts";

export interface UsageLimitHint {
  readonly resetsAt: string | null;
}

/** One session's watch; `take` hands the Turn's hint over and clears it. */
export const usageLimitWatch = () => {
  let hint: UsageLimitHint | undefined;

  return {
    onMessage: (message: SDKMessage) => {
      if (message.type === "rate_limit_event" && message.rate_limit_info.status === "rejected")
        hint = { resetsAt: isoFromEpochSeconds(message.rate_limit_info.resetsAt ?? null) };
      else if (message.type === "assistant" && message.error === "rate_limit")
        hint = { resetsAt: hint?.resetsAt ?? null };
    },
    take: (): UsageLimitHint | undefined => {
      const taken = hint;
      hint = undefined;

      return taken;
    },
  };
};
