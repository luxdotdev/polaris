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
const MAX_EDITS = 500;

const MAX_LINES = 20_000;

/**
 * Past this many characters of input (both sides), no line diff is built: the counts come
 * from one linear scan (`scanCounts`), so a huge Write costs no more than reading it.
 */
export const FILE_PATCH_INPUT_BUDGET = 4 * FILE_PATCH_CAP;

/**
 * A text's lines, without their `\n`; the empty text has none. A last line with no `\n`
 * keeps one as its marker (no other line holds one), so `a` and `a\n` differ, as in `diff`.
 */
const linesOf = (text: string): ReadonlyArray<string> => {
  if (text === "") return [];
  const lines = text.split("\n");
  const last = lines.pop() ?? "";

  if (last !== "") lines.push(`${last}\n`);

  return lines;
};

/** The end of the line starting at `from`, past its `\n`. */
const lineEnd = (text: string, from: number) => {
  const at = text.indexOf("\n", from);

  return at === -1 ? text.length : at + 1;
};

/** Lines in `text[from, to)`, a last one without `\n` included. */
const lineCount = (text: string, from: number, to: number) => {
  let count = 0;

  for (let at = from; at < to; count++) {
    const next = text.indexOf("\n", at);
    at = next === -1 ? to : next + 1;
  }

  return count;
};

/**
 * How many characters `a` and `b` share, `at(i)` the i-th from the start or end: whole blocks
 * compared natively, halving at a difference, the last few one by one.
 */
const common = (
  limit: number,
  same: (from: number, to: number) => boolean,
  at: (i: number) => [number, number]
) => {
  let done = 0;
  let step = 4096;

  while (done < limit) {
    const end = Math.min(limit, done + step);

    if (same(done, end)) {
      done = end;
      step *= 2;
    } else if (end - done > 32) {
      step = Math.ceil((end - done) / 2);
    } else {
      for (; done < end; done++) {
        const [x, y] = at(done);

        if (x !== y) return done;
      }
    }
  }

  return done;
};

/**
 * Counts in one pass that keeps no line: the common head and tail (whole lines) are skipped and
 * every line between counts as changed, so the counts are an upper bound.
 */
const scanCounts = (before: string, after: string) => {
  const shorter = Math.min(before.length, after.length);

  const prefix = common(
    shorter,
    (from, to) => before.substring(from, to) === after.substring(from, to),
    (i) => [before.charCodeAt(i), after.charCodeAt(i)]
  );

  const head = before.lastIndexOf("\n", prefix - 1) + 1;

  const tailOf = (text: string, from: number, to: number) =>
    text.substring(text.length - to, text.length - from);

  let suffix = common(
    shorter - head,
    (from, to) => tailOf(before, from, to) === tailOf(after, from, to),
    (i) => [before.charCodeAt(before.length - 1 - i), after.charCodeAt(after.length - 1 - i)]
  );

  // The tail starts a line in both: right after a newline, or after the first one inside it.
  const startsLine = (text: string) =>
    text.length - suffix === head || text[text.length - suffix - 1] === "\n";

  if (!(startsLine(before) && startsLine(after))) {
    const newline = before.indexOf("\n", before.length - suffix);
    suffix = newline === -1 ? 0 : before.length - newline - 1;
  }

  return {
    removed: lineCount(before, head, before.length - suffix),
    added: lineCount(after, head, after.length - suffix),
  };
};

type Op = { readonly kind: " " | "-" | "+"; readonly line: string };

/** Whether the furthest path on diagonal `k` comes down from `k + 1` (an insertion). */
const goesDown = (v: Int32Array, at: (k: number) => number, k: number, d: number) =>
  k === -d || (k !== d && v[at(k - 1)]! < v[at(k + 1)]!);

/** Myers' edit script of `a` to `b` (both already trimmed); null past `MAX_EDITS` edits. */
const myers = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): Array<Op> | null => {
  const n = a.length;
  const m = b.length;

  // At least |n - m| edits, so past the bound there's no search; one side empty needs none.
  if (n + m > MAX_LINES || Math.abs(n - m) > MAX_EDITS || n === 0 || m === 0) return null;
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

/** An edit script, and how many common leading lines it left out (the same in both texts). */
interface Script {
  readonly ops: ReadonlyArray<Op>;
  readonly skipped: number;
}

const context = (lines: ReadonlyArray<string>): Array<Op> =>
  lines.map((line): Op => ({ kind: " ", line }));

/**
 * The edit script of `before` to `after`: common ends trimmed (keeping `CONTEXT` lines of
 * each), then Myers, else a whole swap. Null when the texts are the same.
 */
const editScript = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): Script | null => {
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

  if (a.length === 0 && b.length === 0) return null;

  const middle = myers(a, b) ?? [
    ...a.map((line): Op => ({ kind: "-", line })),
    ...b.map((line): Op => ({ kind: "+", line })),
  ];

  const skipped = Math.max(0, start - CONTEXT);
  const tail = before.length - end;

  return {
    ops: [
      ...context(before.slice(skipped, start)),
      ...middle,
      ...context(before.slice(tail, tail + CONTEXT)),
    ],
    skipped,
  };
};

const NO_NEWLINE = "\\ No newline at end of file";

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

  /** One line; a last line without `\n` (its marker) is followed by diff's note saying so. */
  line(kind: string, line: string): void {
    if (kind === "+") this.added++;
    else if (kind === "-") this.removed++;

    this.write(
      line.endsWith("\n") ? `${kind}${line.slice(0, -1)}\n${NO_NEWLINE}\n` : `${kind}${line}\n`
    );
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
const positions = ({ ops, skipped }: Script) => {
  const oldAt = new Int32Array(ops.length + 1);
  const newAt = new Int32Array(ops.length + 1);
  oldAt[0] = skipped + 1;
  newAt[0] = skipped + 1;

  ops.forEach((op, i) => {
    oldAt[i + 1] = oldAt[i]! + (op.kind === "+" ? 0 : 1);
    newAt[i + 1] = newAt[i]! + (op.kind === "-" ? 0 : 1);
  });

  return { oldAt, newAt };
};

/** Writes the ops' hunks, `CONTEXT` lines of context around each run of changes. */
const writeHunks = (writer: PatchWriter, script: Script): void => {
  const { ops } = script;
  const changed = ops.flatMap((op, i) => (op.kind === " " ? [] : [i]));
  const { oldAt, newAt } = positions(script);
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
 * The patch from `before` to `after` (a file's whole text, or an edited fragment of it): a
 * line diff, minimal unless the changed middles differ by over 500 lines or span 20,000, when
 * the middle is replaced whole. Past `FILE_PATCH_INPUT_BUDGET` characters, or 20,000 lines,
 * it is counts only (`truncated`), from a linear scan. Either way the counts may then overcount.
 */
export const filePatch = (before: string, after: string): FilePatch => {
  if (before.length + after.length > FILE_PATCH_INPUT_BUDGET) {
    const { added, removed } = scanCounts(before, after);

    return countsOnlyPatch(added, removed);
  }

  const a = linesOf(before);
  const b = linesOf(after);

  if (a.length + b.length > MAX_LINES) {
    const { added, removed } = scanCounts(before, after);

    return countsOnlyPatch(added, removed);
  }

  const writer = new PatchWriter();
  const script = editScript(a, b);

  if (script !== null) writeHunks(writer, script);

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
 * A patch from unified diff text a Harness made (Codex's `diff`, Claude Code's hunks): what
 * comes before the first hunk (file headers) is dropped; `\\ No newline` notes are kept.
 */
export const patchFromUnifiedDiff = (diff: string): FilePatch => {
  const writer = new PatchWriter();
  let inHunk = false;

  for (let at = 0; at < diff.length;) {
    const end = lineEnd(diff, at);
    const line = diff.slice(at, diff[end - 1] === "\n" ? end - 1 : end);
    at = end;

    if (line.startsWith("@@")) inHunk = true;

    if (!inHunk) continue;

    if (line.startsWith("@@") || line.startsWith("\\")) writer.write(`${line}\n`);
    else writer.line(line[0] ?? " ", line.slice(1));
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
