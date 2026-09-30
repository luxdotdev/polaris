/**
 * Which context-usage reports are worth an event. A Harness reports after
 * every model call; the log keeps a report only when the header would change.
 */
import type { ContextUsage } from "@polaris/protocol";

/** Without a known window, a change this big (in tokens) is worth recording. */
const UNKNOWN_WINDOW_STEP = 1000;

/** True when `next` moves the context by a whole percent, changes the window, or is the first. */
export const contextChanged = (previous: ContextUsage | null, next: ContextUsage): boolean => {
  if (previous === null || previous.windowTokens !== next.windowTokens) return true;

  const step =
    next.windowTokens === null ? UNKNOWN_WINDOW_STEP : Math.max(1, next.windowTokens / 100);

  return Math.abs(next.usedTokens - previous.usedTokens) >= step;
};
