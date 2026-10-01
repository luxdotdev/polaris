/**
 * Codex's own commands a Turn can carry. app-server doesn't read slash
 * commands in a message, so `/compact` and `/review` become its calls;
 * anything else is sent to the model as written.
 */
import type * as P from "./protocol.ts";

export type HarnessCall =
  | {
      readonly method: "thread/compact/start";
      readonly params: P.ClientParams["thread/compact/start"];
    }
  | { readonly method: "review/start"; readonly params: P.ClientParams["review/start"] };

const REVIEW = /^\/review(?:\s+([\s\S]*))?$/;

/** The app-server call a Turn's prompt stands for, or null for an ordinary Turn. */
export const harnessCallOf = (prompt: string, threadId: string): HarnessCall | null => {
  const text = prompt.trim();

  if (text === "/compact") return { method: "thread/compact/start", params: { threadId } };
  const review = REVIEW.exec(text);

  if (review === null) return null;
  const instructions = review[1]?.trim() ?? "";

  return {
    method: "review/start",
    params: {
      threadId,
      delivery: "inline",
      target:
        instructions === "" ? { type: "uncommittedChanges" } : { type: "custom", instructions },
    },
  };
};
