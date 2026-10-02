/**
 * The structured patch `inline.propose` returns: replacements as half-open UTF-16 offsets
 * into the buffer the request carried. Here it is checked against that buffer, turned into
 * line hunks for the inline diff, and counted for the card's footer.
 */

export interface Replacement {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface InlinePatch {
  readonly replacements: ReadonlyArray<Replacement>;
  readonly summary: string;
}

/** The replacements in order, or null when one is out of range or two overlap. */
export const checkedReplacements = (
  patch: InlinePatch,
  docLength: number
): ReadonlyArray<Replacement> | null => {
  const sorted = [...patch.replacements].sort((a, b) => a.from - b.from || a.to - b.to);
  let end = 0;

  for (const r of sorted) {
    if (r.from < end || r.to < r.from || r.to > docLength) return null;
    end = r.to;
  }

  return sorted;
};

/** One changed run of whole lines: removed in place, added below them. */
export interface Hunk {
  /** 1-based line of the first removed line, or of the line the additions follow (0: the top). */
  readonly line: number;
  readonly removed: ReadonlyArray<string>;
  readonly added: ReadonlyArray<string>;
}

const lineStart = (doc: string, pos: number) => doc.lastIndexOf("\n", pos - 1) + 1;

const lineEnd = (doc: string, pos: number) => {
  const at = doc.indexOf("\n", pos);

  return at === -1 ? doc.length : at;
};

const lineOf = (doc: string, pos: number) => {
  let line = 1;

  for (let i = doc.indexOf("\n"); i !== -1 && i < pos; i = doc.indexOf("\n", i + 1)) line++;

  return line;
};

/** The whole lines a replacement touches, before and after, without lines both share at the ends. */
const hunkOf = (doc: string, r: Replacement): Hunk | null => {
  const start = lineStart(doc, r.from);
  // A range ending at a line's start doesn't touch that line.
  const end = r.to > r.from && doc[r.to - 1] === "\n" ? r.to - 1 : lineEnd(doc, r.to);
  const before = doc.slice(start, end).split("\n");
  const after = (doc.slice(start, r.from) + r.text + doc.slice(r.to, end)).split("\n");
  let head = 0;

  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;

  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const removed = before.slice(head, before.length - tail);
  const added = after.slice(head, after.length - tail);

  if (removed.length === 0 && added.length === 0) return null;
  const first = lineOf(doc, start) + head;

  return { line: removed.length === 0 ? first - 1 : first, removed, added };
};

export const hunksOf = (doc: string, replacements: ReadonlyArray<Replacement>): Array<Hunk> =>
  replacements.flatMap((r) => hunkOf(doc, r) ?? []);

export interface PatchStats {
  readonly changes: number;
  readonly added: number;
  readonly removed: number;
}

export const statsOf = (hunks: ReadonlyArray<Hunk>): PatchStats => ({
  changes: hunks.length,
  added: hunks.reduce((n, h) => n + h.added.length, 0),
  removed: hunks.reduce((n, h) => n + h.removed.length, 0),
});

/** "Thought for 4s", "Thought for 1m 5s"; under a second still reads 1s. */
export const thoughtLabel = (ms: number): string => {
  const seconds = Math.max(1, Math.round(ms / 1000));

  if (seconds < 60) return `Thought for ${seconds}s`;
  const rest = seconds % 60;

  return `Thought for ${Math.floor(seconds / 60)}m${rest === 0 ? "" : ` ${rest}s`}`;
};

export const changesLabel = (n: number) => (n === 1 ? "1 change" : `${n} changes`);

/** "lines 10–19", "line 4" for the card's range. */
export const rangeLabel = (first: number, last: number) =>
  first === last ? `line ${first}` : `lines ${first}–${last}`;
