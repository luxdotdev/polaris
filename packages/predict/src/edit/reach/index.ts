import type { EditHistoryHunk } from "@polaris/protocol";
import { buffer, lineOf, type ReachSignal, sources, TIERS } from "./sources.ts";

export type { ReachSignal } from "./sources.ts";

export interface ReachInput {
  readonly buffer: string;
  readonly path: string;
  readonly cursor: number;
  /** The last request's window in the current buffer; probes go outside it. */
  readonly window: { readonly from: number; readonly to: number };
  /** The frozen history, oldest first; its last hunk is the last edit or accepted prediction. */
  readonly history: readonly EditHistoryHunk[];
}

export interface ReachOptions {
  readonly signals?: readonly ReachSignal[];
  /** Lines a probe's window spans on each side of its focus (Sweep: 10). */
  readonly radius?: number;
  /** Uses above which a name ranks after rarer ones in its tier. */
  readonly common?: number;
}

const nameAt = (text: string, offset: number) =>
  /^[$\w]*/.exec(text.slice(offset, offset + 200))?.[0] ?? "";

export const REACH_SIGNALS: readonly ReachSignal[] = [
  "orphan",
  "moved",
  "last",
  "callee",
  "history",
  "signature",
  "kept",
];

interface Candidate {
  readonly offset: number;
  readonly line: number;
  readonly tier: number;
  /** A name used everywhere says little about where the next edit is. */
  readonly common: boolean;
}

/**
 * Ordered UTF-16 focuses for jump probes, each outside the window and outside the windows of
 * earlier focuses. The caller probes the first, cancels on typing, and keeps history frozen.
 */
export const reachFocuses = (input: ReachInput, options: ReachOptions = {}): number[] => {
  const { cursor, window } = input;

  if (!Number.isInteger(cursor) || cursor < 0 || cursor > input.buffer.length) return [];
  const radius = options.radius ?? 10;
  const b = buffer(input.buffer);
  const hunks = input.history.filter((hunk) => hunk.path === input.path);
  const cursorLine = lineOf(b, cursor);

  const candidates: Candidate[] = (options.signals ?? REACH_SIGNALS).flatMap((signal) =>
    sources[signal](b, hunks)
      .filter((offset) => offset < window.from || offset >= window.to)
      .map((offset) => ({
        offset,
        line: lineOf(b, offset),
        tier: TIERS[signal],
        common: (b.uses.get(nameAt(input.buffer, offset)) ?? 0) > (options.common ?? 2),
      }))
  );

  candidates.sort(
    (a, b) =>
      a.tier - b.tier ||
      Number(a.common) - Number(b.common) ||
      Math.abs(a.line - cursorLine) - Math.abs(b.line - cursorLine) ||
      a.offset - b.offset
  );
  const chosen: Candidate[] = [];

  for (const c of candidates)
    if (chosen.every((p) => Math.abs(p.line - c.line) > radius)) chosen.push(c);

  return chosen.map((c) => c.offset);
};
