/**
 * The git gutter's marks (DESIGN.md, Editor → Git status): the buffer's lines
 * against the file at HEAD, as added and modified runs and deletion points.
 * A line diff (Myers, O(ND)) after trimming the common head and tail.
 */

export type GutterMark =
  /** New lines `from`…`to` (1-based, inclusive). */
  | { readonly kind: "added"; readonly from: number; readonly to: number }
  /** Changed lines `from`…`to`. */
  | { readonly kind: "modified"; readonly from: number; readonly to: number }
  /** Lines were removed just above line `at` (`lines + 1` when removed at the end). */
  | { readonly kind: "deleted"; readonly at: number };

/** Past this many edits the middle is marked modified wholesale: a rewrite, not a diff. */
const MAX_EDITS = 1000;

interface Hunk {
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newStart: number;
  readonly newEnd: number;
}

const interned = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  const ids = new Map<string, number>();

  const id = (line: string) => {
    let n = ids.get(line);

    if (n === undefined) ids.set(line, (n = ids.size));

    return n;
  };

  return [Int32Array.from(a, id), Int32Array.from(b, id)] as const;
};

/**
 * Myers' greedy forward pass. Each round keeps only its frontier's live diagonals
 * (−d…d), so memory is O(D²), not O(D·(N+M)).
 */
const trace = (a: Int32Array, b: Int32Array): Array<Int32Array> | null => {
  const n = a.length;
  const m = b.length;
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 1);
  const rounds: Array<Int32Array> = [];

  for (let d = 0; d <= Math.min(n + m, MAX_EDITS); d++) {
    rounds.push(v.slice(offset - d, offset + d + 1));

    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
      let x = down ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) return rounds;
    }
  }

  return null;
};

/** Walks the trace back into equal-line pairs, then reads the gaps between them as hunks. */
const hunksOf = (a: Int32Array, b: Int32Array, rounds: Array<Int32Array>): Array<Hunk> => {
  const pairs: Array<readonly [number, number]> = [];
  let x = a.length;
  let y = b.length;

  for (let d = rounds.length - 1; d >= 0; d--) {
    // Round d's snapshot holds diagonal k at index d + k.
    const v = rounds[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && v[d + k - 1]! < v[d + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : v[d + prevK]!;
    const prevY = d === 0 ? 0 : prevX - prevK;

    while (x > prevX && y > prevY) pairs.push([--x, --y]);

    x = prevX;
    y = prevY;
  }

  pairs.reverse();
  const hunks: Array<Hunk> = [];
  let ai = 0;
  let bi = 0;

  for (const [pa, pb] of [...pairs, [a.length, b.length] as const]) {
    if (pa > ai || pb > bi) hunks.push({ oldStart: ai, oldEnd: pa, newStart: bi, newEnd: pb });

    ai = pa + 1;
    bi = pb + 1;
  }

  return hunks;
};

const markOf = (hunk: Hunk, shift: number): GutterMark => {
  const from = hunk.newStart + shift + 1;
  const to = hunk.newEnd + shift;

  if (hunk.oldEnd === hunk.oldStart) return { kind: "added", from, to };

  if (hunk.newEnd === hunk.newStart) return { kind: "deleted", at: from };

  return { kind: "modified", from, to };
};

/** Splits text into lines the way an editor numbers them. */
export const linesOf = (text: string): ReadonlyArray<string> => text.split(/\r?\n/);

export const gutterMarks = (
  base: ReadonlyArray<string>,
  doc: ReadonlyArray<string>
): ReadonlyArray<GutterMark> => {
  let head = 0;

  while (head < base.length && head < doc.length && base[head] === doc[head]) head++;
  let tail = 0;

  while (
    tail < base.length - head &&
    tail < doc.length - head &&
    base[base.length - 1 - tail] === doc[doc.length - 1 - tail]
  ) {
    tail++;
  }

  const [a, b] = interned(base.slice(head, base.length - tail), doc.slice(head, doc.length - tail));

  if (a.length === 0 && b.length === 0) return [];
  const rounds = trace(a, b);

  const hunks =
    rounds === null
      ? [{ oldStart: 0, oldEnd: a.length, newStart: 0, newEnd: b.length }]
      : hunksOf(a, b, rounds);

  return hunks.map((hunk) => markOf(hunk, head));
};
