/**
 * The control row's readouts (Paper MX-E): the running Subagents as moons with a count, and
 * the context ring, as the Desktop App's composer reads them (`ComposerStatus.tsx`).
 */
import type { ContextUsage, Subagent } from "@polaris/protocol";

/** Moons drawn before the count says the rest. */
export const MOONS_SHOWN = 3;

/** At or past this share the window reads as nearly full. */
export const CONTEXT_NEARLY_FULL = 0.85;

export interface Moons {
  /** Each shown moon's place among the session's Subagents, which picks its body. */
  readonly moons: ReadonlyArray<{ readonly id: string; readonly index: number }>;
  readonly running: number;
}

/** The working Subagents, in the order they started; nothing when none is working. */
export const moonsOf = (subagents: ReadonlyArray<Subagent>): Moons => {
  const working = subagents.flatMap((subagent, index) =>
    subagent.status === "working" ? [{ subagent, index }] : []
  );

  return {
    moons: working.slice(0, MOONS_SHOWN).map(({ subagent, index }) => ({ id: subagent.id, index })),
    running: working.length,
  };
};

export interface ContextRing {
  /** The ring's fill, 0–1; empty while the window is unknown. */
  readonly share: number;
  /** "17%", "84k" while the window is unknown, "—" before any report. */
  readonly words: string;
  readonly nearlyFull: boolean;
}

/** "840", "84k", "1.2M". */
export const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return `${tokens}`;

  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;

  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
};

/** An empty ring and "—" until the Harness reports usage, never 0%. */
export const contextRing = (usage: ContextUsage | null): ContextRing => {
  if (usage === null) return { share: 0, words: "—", nearlyFull: false };

  if (usage.windowTokens === null || usage.windowTokens <= 0)
    return { share: 0, words: formatTokens(usage.usedTokens), nearlyFull: false };
  const share = Math.min(1, Math.max(0, usage.usedTokens / usage.windowTokens));

  return { share, words: `${Math.round(share * 100)}%`, nearlyFull: share >= CONTEXT_NEARLY_FULL };
};

/** How many of the ring's segments are lit, as MX-E draws it in twenty. */
export const RING_SEGMENTS = 20;

export const litSegments = (share: number): number =>
  share <= 0 ? 0 : Math.max(1, Math.round(share * RING_SEGMENTS));
