/**
 * The jump probe (docs/specs/edit-prediction-v1.1.md §4): where to ask the model next when the
 * cursor request shows nothing. Balanced uses §4's rule; Eager the measured reach signals.
 */
import type { EditHistoryHunk } from "@polaris/protocol";
import { reachFocuses } from "@polaris/predict";
import type { JumpProbe } from "../../../../../shared/predictionPlacement.ts";
import type { LastEdit } from "./history.ts";

const IDENTIFIER = /[\p{L}_$][\p{L}\p{N}_$]*/gu;

const MIN_IDENTIFIER = 2;

/** Identifiers in `removed` that `added` no longer has: a rename's old name, a replaced call. */
export const identifiersRemoved = (removed: string, added: string): ReadonlyArray<string> => {
  const after = new Set(added.match(IDENTIFIER) ?? []);
  const seen = new Set<string>();

  for (const name of removed.match(IDENTIFIER) ?? [])
    if (name.length >= MIN_IDENTIFIER && !after.has(name)) seen.add(name);

  return [...seen];
};

const escape = (name: string) => name.replace(/[$^\\.*+?()[\]{}|]/g, "\\$&");

const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_$]/u.test(char);

/** The whole-word occurrence outside `window` nearest to `cursor`; null when there is none. */
export const probeTarget = (
  buffer: string,
  identifiers: ReadonlyArray<string>,
  window: { readonly from: number; readonly to: number },
  cursor: number
): number | null => {
  if (identifiers.length === 0) return null;
  const pattern = new RegExp(identifiers.map(escape).join("|"), "gu");
  let best: number | null = null;

  for (const match of buffer.matchAll(pattern)) {
    const from = match.index;
    const to = from + match[0].length;

    if (isWord(buffer[from - 1]) || isWord(buffer[to])) continue;

    if (from >= window.from && from < window.to) continue;

    if (best === null || Math.abs(from - cursor) < Math.abs(best - cursor)) best = from;
  }

  return best;
};

export interface ProbeInput {
  readonly buffer: string;
  readonly path: string;
  readonly cursor: number;
  /** The last request's window; the probe looks outside it. */
  readonly window: { readonly from: number; readonly to: number };
  /** Oldest first, ending with the live burst. */
  readonly history: ReadonlyArray<EditHistoryHunk>;
  readonly last: LastEdit;
}

const PROBES: Readonly<Record<JumpProbe, (input: ProbeInput) => number | null>> = {
  off: () => null,
  spec: ({ buffer, window, cursor, last }) =>
    probeTarget(buffer, identifiersRemoved(last.removed, last.added), window, cursor),
  reach: (input) => reachFocuses(input)[0] ?? null,
};

/** The one focus to probe, or null; later reach focuses showed more danger and nothing useful. */
export const jumpFocus = (probe: JumpProbe, input: ProbeInput): number | null =>
  PROBES[probe](input);
