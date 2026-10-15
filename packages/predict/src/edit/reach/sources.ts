import type { EditHistoryHunk } from "@polaris/protocol";
import {
  addedNames,
  boundNames,
  declarationOffsets,
  declarations,
  declaredNames,
  identifiers,
  keptNames,
  type Occurrence,
  goneNames,
  removedNames,
} from "./names.ts";

export type ReachSignal = "orphan" | "moved" | "last" | "callee" | "history" | "signature" | "kept";

/** Probe order: a lower tier is probed first, then the nearest. */
export const TIERS: Readonly<Record<ReachSignal, number>> = {
  orphan: 0,
  moved: 0,
  last: 1,
  callee: 1,
  history: 2,
  signature: 3,
  kept: 4,
};

export interface Buffer {
  readonly text: string;
  readonly starts: readonly number[];
  readonly occurrences: readonly Occurrence[];
  readonly uses: ReadonlyMap<string, number>;
  /** Offsets of names bound by a keyword declaration. */
  readonly declared: ReadonlySet<number>;
}

export const buffer = (text: string): Buffer => {
  const starts = [0];

  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const occurrences = identifiers(text);
  const uses = new Map<string, number>();

  for (const { name } of occurrences) uses.set(name, (uses.get(name) ?? 0) + 1);
  const declared = new Set(declarationOffsets(text));

  return { text, starts, occurrences, uses, declared };
};

export const lineOf = (b: Buffer, offset: number) => {
  let lo = 0;
  let hi = b.starts.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;

    if ((b.starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }

  return lo;
};

const occurrencesOf = (b: Buffer, names: Iterable<string>) => {
  const wanted = new Set(names);

  return b.occurrences.filter((o) => wanted.has(o.name)).map((o) => o.offset);
};

/** Where the hunk's text sits now: the copy nearest its recorded line, if it is intact. */
const ownRange = (b: Buffer, hunk: EditHistoryHunk) => {
  const near = b.starts[hunk.line] ?? 0;
  let best: number | undefined;

  for (
    let i = b.text.indexOf(hunk.after);
    i !== -1 && hunk.after;
    i = b.text.indexOf(hunk.after, i + 1)
  )
    if (best === undefined || Math.abs(i - near) < Math.abs(best - near)) best = i;

  return best === undefined ? undefined : { from: best, to: best + hunk.after.length };
};

/** Drops the hunk's own copy: inside its text, else the one nearest its line. */
const others = (b: Buffer, offsets: readonly number[], hunk: EditHistoryHunk) => {
  const own = ownRange(b, hunk);

  if (own) return offsets.filter((o) => o < own.from || o >= own.to);

  if (offsets.length < 2) return [];

  const nearest = offsets.reduce((best, o) =>
    Math.abs(lineOf(b, o) - hunk.line) < Math.abs(lineOf(b, best) - hunk.line) ? o : best
  );

  return offsets.filter((o) => o !== nearest);
};

const trimmedLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 10 && /[$A-Z_a-z]/.test(line));

/** A line or declaration the history added that still exists elsewhere: the copy left behind. */
const moved = (b: Buffer, hunk: EditHistoryHunk): number[] => {
  const lines = new Set(trimmedLines(hunk.after));
  const copies: number[] = [];
  b.starts.forEach((start, i) => {
    const line = b.text.slice(start, (b.starts[i + 1] ?? b.text.length + 1) - 1);

    if (lines.has(line.trim())) copies.push(start + line.length - line.trimStart().length);
  });
  const names = boundNames(hunk.after).filter((name) => addedNames(hunk).includes(name));

  return [
    ...others(b, copies, hunk),
    ...names.flatMap((name) => others(b, declarations(b.text, name), hunk)),
  ];
};

/** The definition of the function whose call the hunk changed (an added argument). */
const callee = (b: Buffer, hunk: EditHistoryHunk): number[] => {
  let depth = 0;
  const end = b.starts[hunk.line] ?? 0;

  for (let i = end - 1; i >= Math.max(0, end - 4000); i--) {
    const ch = b.text[i];

    if (ch === ")" || ch === "]" || ch === "}") depth++;
    else if (ch === "[" || ch === "{") depth--;
    else if (ch === "(" && depth-- === 0) {
      const name = /([$A-Z_a-z][$\w]*)\s*(?:<[^()]*>)?\s*$/.exec(
        b.text.slice(Math.max(0, i - 200), i)
      );

      return name?.[1] ? declarations(b.text, name[1]) : [];
    }

    if (depth < 0) return [];
  }

  return [];
};

export type Sources = Readonly<
  Record<ReachSignal, (b: Buffer, hunks: readonly EditHistoryHunk[]) => number[]>
>;

export const sources: Sources = {
  orphan: (b, hunks) =>
    occurrencesOf(
      b,
      hunks.flatMap(removedNames).filter((name) => b.uses.get(name) === 1)
    ).filter((offset) => b.declared.has(offset)),
  moved: (b, hunks) => hunks.flatMap((hunk) => moved(b, hunk)),
  last: (b, hunks) => occurrencesOf(b, hunks.at(-1) ? goneNames(hunks.at(-1)!) : []),
  callee: (b, hunks) => (hunks.at(-1) ? callee(b, hunks.at(-1)!) : []),
  history: (b, hunks) => occurrencesOf(b, hunks.flatMap(goneNames)),
  signature: (b, hunks) =>
    occurrencesOf(
      b,
      hunks.flatMap((hunk) => declaredNames(hunk.after).filter((n) => keptNames(hunk).includes(n)))
    ),
  kept: (b, hunks) => occurrencesOf(b, hunks.at(-1) ? keptNames(hunks.at(-1)!) : []),
};
