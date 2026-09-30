/**
 * The meta lines of a session view: how long the Harness thought, which step
 * of a plan it is on, and how full its context window is.
 */
import type { ContextUsage } from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";
import { formatElapsed } from "./format.ts";
import type { PlanStep } from "./items.ts";

/** From this share of the window, the header says the context is nearly full. */
export const CONTEXT_NEARLY_FULL = 0.85;

/** Under a second still reads as a second: the row says thinking happened. */
const atLeastASecond = (ms: number) => Math.max(ms, 1000);

export interface ReasoningTimes {
  readonly live: boolean;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

export interface ThoughtLabel {
  readonly label: string;
  /** The time so far, while live and timed. */
  readonly elapsed: string | null;
}

/**
 * The reasoning row's label: "Thinking" (with its elapsed time while live and
 * timed), "Thought for 12s" once done and timed, else "Thought".
 */
export const thoughtLabel = (reasoning: ReasoningTimes, now: number): ThoughtLabel => {
  const started = reasoning.startedAt === null ? Number.NaN : Date.parse(reasoning.startedAt);

  if (reasoning.live || reasoning.endedAt === null) {
    const elapsed = Number.isNaN(started) || !reasoning.live ? null : formatElapsed(now - started);

    return { label: reasoning.live ? "Thinking…" : "Thought", elapsed };
  }

  const ended = Date.parse(reasoning.endedAt);

  if (Number.isNaN(started) || Number.isNaN(ended)) return { label: "Thought", elapsed: null };

  return { label: `Thought for ${formatElapsed(atLeastASecond(ended - started))}`, elapsed: null };
};

/** What a step reads as: the current step says what it is doing now, when the Harness says. */
export const stepLabel = (step: PlanStep): string =>
  step.status === "in-progress" && step.detail !== null && step.detail.trim() !== ""
    ? step.detail
    : step.text;

/** "84k", "1.2M": token counts as the header's tooltip prints them. */
export const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return `${tokens}`;

  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;

  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
};

export interface ContextLabel {
  /** "Context 42%", or "Context 91% · nearly full". */
  readonly text: string;
  /** "84k of 200k tokens", for the tooltip. */
  readonly detail: string;
}

/** The header's context line; null (hidden) until the Harness reports its window. */
export const contextLabel = (usage: Plain<ContextUsage> | null): ContextLabel | null => {
  if (usage === null || usage.windowTokens === null || usage.windowTokens <= 0) return null;
  const share = Math.min(1, Math.max(0, usage.usedTokens / usage.windowTokens));
  const percent = `Context ${Math.round(share * 100)}%`;

  return {
    text: share >= CONTEXT_NEARLY_FULL ? `${percent} · nearly full` : percent,
    detail: `${formatTokens(usage.usedTokens)} of ${formatTokens(usage.windowTokens)} tokens in context`,
  };
};
