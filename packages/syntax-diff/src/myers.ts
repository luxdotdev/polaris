/**
 * Myers' O(ND) diff over any sequence, by index. The common prefix and suffix are cut first,
 * and each step keeps only the diagonals it reached, so memory grows with the edits, not the file.
 */

export type EditOp =
  | { readonly type: "equal"; readonly a: number; readonly b: number }
  | { readonly type: "delete"; readonly a: number }
  | { readonly type: "insert"; readonly b: number };

/** More edits than the caller allowed: too different to diff this way. */
export class TooComplex extends Error {
  constructor(readonly edits: number) {
    super(`more than ${edits} edits`);
  }
}

type Same = (a: number, b: number) => boolean;

const backtrack = (trace: ReadonlyArray<Int32Array>, n: number, m: number): Array<EditOp> => {
  const ops: Array<EditOp> = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d--) {
    const snapshot = trace[d] ?? new Int32Array(0);
    const at = (k: number) => snapshot[k + d + 1] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: "equal", a: x - 1, b: y - 1 });
      x--;
      y--;
    }

    if (d > 0) ops.push(x > prevX ? { type: "delete", a: x - 1 } : { type: "insert", b: y - 1 });
    x = prevX;
    y = prevY;
  }

  return ops.reverse();
};

/** The furthest `x` on diagonal `k` after `d` edits, following the snake of matches. */
const furthest = (
  v: Int32Array,
  offset: number,
  d: number,
  k: number,
  same: Same,
  n: number,
  m: number
) => {
  const left = v[offset + k - 1] ?? 0;
  const right = v[offset + k + 1] ?? 0;
  let x = k === -d || (k !== d && left < right) ? right : left + 1;
  let y = x - k;

  while (x < n && y < m && same(x, y)) {
    x++;
    y++;
  }

  return x;
};

/** The edit script of `a[0, n)` into `b[0, m)`. */
const core = (n: number, m: number, same: Same, maxEdits: number): Array<EditOp> => {
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Array<Int32Array> = [];

  for (let d = 0; d <= max; d++) {
    if (d > maxEdits) throw new TooComplex(maxEdits);
    // Step d reads only the diagonals -d-1 … d+1 of the step before.
    trace.push(v.slice(offset - d - 1, offset + d + 2));

    for (let k = -d; k <= d; k += 2) {
      const x = furthest(v, offset, d, k, same, n, m);

      v[offset + k] = x;

      if (x >= n && x - k >= m) return backtrack(trace, n, m);
    }
  }

  return backtrack(trace, n, m);
};

const shifted = (op: EditOp, by: number): EditOp => {
  if (op.type === "equal") return { type: "equal", a: op.a + by, b: op.b + by };

  return op.type === "delete" ? { type: "delete", a: op.a + by } : { type: "insert", b: op.b + by };
};

/**
 * Edits turning `a[0, n)` into `b[0, m)`, where `same(i, j)` compares `a[i]` with `b[j]`;
 * throws `TooComplex` past `maxEdits` insertions and deletions.
 */
export const myers = (
  n: number,
  m: number,
  same: Same,
  maxEdits = Number.POSITIVE_INFINITY
): Array<EditOp> => {
  let start = 0;

  while (start < n && start < m && same(start, start)) start++;
  let endA = n;
  let endB = m;

  while (endA > start && endB > start && same(endA - 1, endB - 1)) {
    endA--;
    endB--;
  }

  const middle = core(endA - start, endB - start, (x, y) => same(start + x, start + y), maxEdits);
  const ops: Array<EditOp> = [];

  for (let i = 0; i < start; i++) ops.push({ type: "equal", a: i, b: i });

  for (const op of middle) ops.push(shifted(op, start));

  for (let i = 0; i < n - endA; i++) ops.push({ type: "equal", a: endA + i, b: endB + i });

  return ops;
};
