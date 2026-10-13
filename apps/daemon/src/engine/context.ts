/**
 * Which context-usage reports are worth an event. A Harness reports after
 * every model call; the log keeps a report only when the header would change.
 */
import { ContextUsage } from "@polaris/protocol";
import type { ContextBreakdown, HarnessEvent } from "../harness/HarnessDriver.ts";

/** Without a known window, a change this big (in tokens) is worth recording. */
const UNKNOWN_WINDOW_STEP = 1000;

type Detail = Pick<ContextUsage, "autoCompactAt" | "mcpServers" | "skills" | "agents" | "messages">;

/** The finer breakdown, from a fresh count when there is one, else kept from the last. */
const detailOf = (counted: ContextBreakdown | undefined, previous: ContextUsage | null): Detail =>
  counted === undefined
    ? {
        autoCompactAt: previous?.autoCompactAt ?? null,
        mcpServers: previous?.mcpServers ?? [],
        skills: previous?.skills ?? null,
        agents: previous?.agents ?? [],
        messages: previous?.messages ?? null,
      }
    : {
        autoCompactAt: counted.autoCompactAt ?? null,
        mcpServers: counted.mcpServers ?? [],
        skills: counted.skills ?? null,
        agents: counted.agents ?? [],
        messages: counted.messages ?? null,
      };

/**
 * A Harness report as the session's usage. A total-only report keeps the last
 * breakdown, which `categoriesTotal` dates.
 */
export const contextUsageOf = (
  report: Extract<HarnessEvent, { readonly _tag: "ContextUsed" }>,
  previous: ContextUsage | null
): ContextUsage => {
  const counted = report.breakdown;

  return new ContextUsage({
    usedTokens: report.usedTokens,
    windowTokens: report.windowTokens,
    categories: counted?.categories ?? previous?.categories ?? [],
    memoryFiles: counted?.memoryFiles ?? previous?.memoryFiles ?? [],
    categoriesTotal: counted?.countedTokens ?? previous?.categoriesTotal ?? null,
    autoCompact: counted?.autoCompact ?? previous?.autoCompact ?? null,
    ...detailOf(counted, previous),
  });
};

/** True when `next` moves the context by a whole percent, changes the window, or is the first. */
export const contextChanged = (previous: ContextUsage | null, next: ContextUsage): boolean => {
  if (previous === null || previous.windowTokens !== next.windowTokens) return true;

  if (
    previous.categoriesTotal !== next.categoriesTotal ||
    previous.autoCompact !== next.autoCompact
  )
    return true;

  const step =
    next.windowTokens === null ? UNKNOWN_WINDOW_STEP : Math.max(1, next.windowTokens / 100);

  return Math.abs(next.usedTokens - previous.usedTokens) >= step;
};
