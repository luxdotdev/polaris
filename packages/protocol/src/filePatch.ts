/**
 * The patch a `FileChange` carries for one file (capability `session.file-patches`, ENG-979),
 * and the builders every producer shares, so each one keeps the same shape and cap.
 *
 * `diff` is unified diff hunks: `@@ -a,b +c,d @@` headers, then lines that start with
 * ` `, `-` or `+`, each ending in `\n`; no `---`/`+++` file headers. Past `FILE_PATCH_CAP`
 * characters the hunks are dropped: `diff` is `""`, `truncated` is true, and the counts stay.
 */
import { Schema } from "effect";

export const FilePatch = Schema.Struct({
  diff: Schema.String,
  added: Schema.Int,
  removed: Schema.Int,
  truncated: Schema.Boolean,
});

export type FilePatch = typeof FilePatch.Type;

/** The most `diff` text one change carries, in characters (about 64 KB). */
export const FILE_PATCH_CAP = 64 * 1024;

/** Lines of unchanged context around each hunk. */
const CONTEXT = 3;

/** Past this many edits, or lines, between the trimmed middles, the middle is replaced whole. */
const MAX_EDITS = 1000;

const MAX_LINES = 20_000;

/** A text's lines, without their `\n`; the empty text has none. */
const linesOf = (text: string): ReadonlyArray<string> => {
  if (text === "") return [];
  const lines = text.split("\n");

  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

type Op = { readonly kind: " " | "-" | "+"; readonly line: string };

/** Whether the furthest path on diagonal `k` comes down from `k + 1` (an insertion). */
const goesDown = (v: Int32Array, at: (k: number) => number, k: number, d: number) =>
  k === -d || (k !== d && v[at(k - 1)]! < v[at(k + 1)]!);

/** Myers' edit script of `a` to `b` (both already trimmed); null past `MAX_EDITS` edits. */
const myers = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): Array<Op> | null => {
  const n = a.length;
  const m = b.length;

  if (n + m > MAX_LINES) return null;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const at = (k: number) => offset + k;
  const v = new Int32Array(2 * max + 3);
  // Each step keeps only its diagonals, -d-1..d+1, so the trace grows as d², not d·max.
  const trace: Array<Int32Array> = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(at(-d - 1), at(d + 1) + 1));

    for (let k = -d; k <= d; k += 2) {
      let x = goesDown(v, at, k, d) ? v[at(k + 1)]! : v[at(k - 1)]! + 1;
      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[at(k)] = x;

      if (x >= n && y >= m) return backtrack(a, b, trace, d);
    }
  }

  return null;
};

const backtrack = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
  trace: ReadonlyArray<Int32Array>,
  edits: number
): Array<Op> => {
  const ops: Array<Op> = [];
  let x = a.length;
  let y = b.length;

  const same = (toX: number) => {
    while (x > toX) {
      x--;
      y--;
      ops.push({ kind: " ", line: a[x]! });
    }
  };

  for (let d = edits; d > 0; d--) {
    const v = trace[d]!;
    const at = (k: number) => k + d + 1;
    const k = x - y;
    const down = goesDown(v, at, k, d);
    const prevK = down ? k + 1 : k - 1;
    same(v[at(prevK)]! + (down ? 0 : 1));

    if (down) ops.push({ kind: "+", line: b[--y]! });
    else ops.push({ kind: "-", line: a[--x]! });
  }

  same(0);

  return ops.reverse();
};

/** The edit script of `before` to `after`: common ends trimmed, then Myers, else a whole swap. */
const editScript = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): Array<Op> => {
  let start = 0;

  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;

  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }

  const a = before.slice(start, before.length - end);
  const b = after.slice(start, after.length - end);

  const middle = myers(a, b) ?? [
    ...a.map((line): Op => ({ kind: "-", line })),
    ...b.map((line): Op => ({ kind: "+", line })),
  ];

  return [
    ...before.slice(0, start).map((line): Op => ({ kind: " ", line })),
    ...middle,
    ...before.slice(before.length - end).map((line): Op => ({ kind: " ", line })),
  ];
};

/** Collects hunk text up to the cap, counting every line either way. */
class PatchWriter {
  private readonly parts: Array<string> = [];
  private size = 0;
  private over = false;
  added = 0;
  removed = 0;

  write(text: string): void {
    if (this.over) return;
    this.size += text.length;

    if (this.size > FILE_PATCH_CAP) {
      this.over = true;
      this.parts.length = 0;
    } else {
      this.parts.push(text);
    }
  }

  line(kind: string, line: string): void {
    if (kind === "+") this.added++;
    else if (kind === "-") this.removed++;
    this.write(`${kind}${line}\n`);
  }

  finish(): FilePatch {
    return {
      diff: this.over ? "" : this.parts.join(""),
      added: this.added,
      removed: this.removed,
      truncated: this.over,
    };
  }
}

const range = (start: number, count: number) =>
  count === 1 ? `${start}` : `${count === 0 ? start - 1 : start},${count}`;

/** Where each op sits: the old and new line numbers it starts at, 1-based. */
const positions = (ops: ReadonlyArray<Op>) => {
  const oldAt = new Int32Array(ops.length + 1);
  const newAt = new Int32Array(ops.length + 1);
  oldAt[0] = 1;
  newAt[0] = 1;

  ops.forEach((op, i) => {
    oldAt[i + 1] = oldAt[i]! + (op.kind === "+" ? 0 : 1);
    newAt[i + 1] = newAt[i]! + (op.kind === "-" ? 0 : 1);
  });

  return { oldAt, newAt };
};

/** Writes the ops' hunks, `CONTEXT` lines of context around each run of changes. */
const writeHunks = (writer: PatchWriter, ops: ReadonlyArray<Op>): void => {
  const changed = ops.flatMap((op, i) => (op.kind === " " ? [] : [i]));
  const { oldAt, newAt } = positions(ops);
  let at = 0;

  while (at < changed.length) {
    const first = changed[at]!;
    let last = first;

    while (at + 1 < changed.length && changed[at + 1]! - last <= 2 * CONTEXT + 1) {
      at++;
      last = changed[at]!;
    }

    at++;
    const from = Math.max(0, first - CONTEXT);
    const to = Math.min(ops.length, last + CONTEXT + 1);
    const oldRange = range(oldAt[from]!, oldAt[to]! - oldAt[from]!);
    const newRange = range(newAt[from]!, newAt[to]! - newAt[from]!);
    writer.write(`@@ -${oldRange} +${newRange} @@\n`);

    for (const op of ops.slice(from, to)) writer.line(op.kind, op.line);
  }
};

/**
 * The patch from `before` to `after` (a file's whole text, or an edited fragment of it):
 * a line diff, minimal unless the changed middles differ by over 1000 lines (or span 20,000), when the
 * middle is replaced whole (so the counts are then an upper bound).
 */
export const filePatch = (before: string, after: string): FilePatch => {
  const writer = new PatchWriter();
  writeHunks(writer, editScript(linesOf(before), linesOf(after)));

  return writer.finish();
};

/** Several patches of one file (MultiEdit's edits) as one: hunks in order, counts summed. */
export const joinFilePatches = (patches: ReadonlyArray<FilePatch>): FilePatch => {
  const writer = new PatchWriter();

  for (const patch of patches) writer.write(patch.diff);
  const joined = writer.finish();
  const truncated = joined.truncated || patches.some((patch) => patch.truncated);

  return {
    diff: truncated ? "" : joined.diff,
    added: patches.reduce((sum, patch) => sum + patch.added, 0),
    removed: patches.reduce((sum, patch) => sum + patch.removed, 0),
    truncated,
  };
};

/**
 * A patch from unified diff text a Harness made (Codex's `diff`, Claude Code's hunks):
 * what comes before the first hunk (file headers) and `\ No newline` markers are dropped.
 */
export const patchFromUnifiedDiff = (diff: string): FilePatch => {
  const writer = new PatchWriter();
  let inHunk = false;

  for (const line of linesOf(diff)) {
    if (line.startsWith("@@")) {
      inHunk = true;
      writer.write(`${line}\n`);
    } else if (inHunk && !line.startsWith("\\")) {
      writer.line(line[0] ?? " ", line.slice(1));
    }
  }

  return writer.finish();
};

/** A patch of counts only (the Harness gave no hunks we can carry). */
export const countsOnlyPatch = (added: number, removed: number): FilePatch => ({
  diff: "",
  added,
  removed,
  truncated: true,
});
