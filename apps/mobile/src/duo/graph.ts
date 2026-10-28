/**
 * The unfolded Duo's constellation graph (Paper D9): tasks in columns by dependency depth, left to
 * right across both halves, with no node on the fold's division. Pure; `ConstellationSpan` draws.
 */
import type { Rect } from "./posture.ts";

export interface GraphTask {
  readonly id: string;
  readonly deps: ReadonlyArray<string>;
  /** Tasks in one group share a column, as D9 stacks B1–B3. */
  readonly group: string | null;
}

export interface Span {
  readonly x: number;
  readonly width: number;
}

/** The fold's division with its axis: a vertical fold splits columns, a horizontal one rows. */
export type Fold =
  | { readonly axis: "vertical"; readonly span: Span }
  | { readonly axis: "horizontal"; readonly span: Span };

export const foldOf = (division: Rect): Fold =>
  division.height >= division.width
    ? { axis: "vertical", span: { x: division.x, width: division.width } }
    : { axis: "horizontal", span: { x: division.y, width: division.height } };

export interface PlacedNode {
  readonly id: string;
  readonly column: number;
  readonly x: number;
  readonly y: number;
}

export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface GraphLayout {
  readonly nodes: ReadonlyArray<PlacedNode>;
  readonly edges: ReadonlyArray<Edge>;
  readonly width: number;
  readonly height: number;
}

export const NODE_WIDTH = 190;

export const NODE_HEIGHT = 46;

const COLUMN_GAP = 32;

const ROW_GAP = 30;

const EDGE = 20;

/** Each task's column: 0 without shown dependencies, else one past its deepest dependency. */
export const depths = (tasks: ReadonlyArray<GraphTask>): ReadonlyMap<string, number> => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();

  const depth = (id: string, seen: ReadonlySet<string>): number => {
    const known = memo.get(id);

    if (known !== undefined) return known;
    const deps = (byId.get(id)?.deps ?? []).filter((d) => byId.has(d) && !seen.has(d));
    const next = new Set(seen).add(id);
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => depth(d, next)));
    memo.set(id, value);

    return value;
  };

  for (const task of tasks) depth(task.id, new Set());

  return memo;
};

/** Each task's column: a group takes its shallowest member's depth; empty depths close up. */
export const columns = (tasks: ReadonlyArray<GraphTask>): ReadonlyMap<string, number> => {
  const depthOf = depths(tasks);
  const groupDepth = new Map<string, number>();

  for (const task of tasks) {
    const depth = depthOf.get(task.id) ?? 0;

    if (task.group !== null)
      groupDepth.set(task.group, Math.min(groupDepth.get(task.group) ?? depth, depth));
  }

  const raw = new Map(
    tasks.map((t) => [
      t.id,
      t.group === null ? (depthOf.get(t.id) ?? 0) : (groupDepth.get(t.group) ?? 0),
    ])
  );

  const used = [...new Set(raw.values())].sort((a, b) => a - b);

  return new Map([...raw].map(([id, depth]) => [id, used.indexOf(depth)]));
};

/** Starts along one axis at a steady pitch, pushed past the division when a node would sit on it. */
const starts = (
  count: number,
  first: number,
  size: number,
  gap: number,
  division: Span | null
): ReadonlyArray<number> => {
  const out: number[] = [];
  let at = first;

  for (let i = 0; i < count; i++) {
    const crosses = division !== null && at < division.x + division.width && at + size > division.x;

    if (crosses) at = division.x + division.width + EDGE;
    out.push(at);
    at += size + gap;
  }

  return out;
};

/** The left edge of each column, pushed past a vertical division when a node would sit on it. */
export const columnLefts = (count: number, division: Span | null): ReadonlyArray<number> =>
  starts(count, EDGE, NODE_WIDTH, COLUMN_GAP, division);

export const graphLayout = (
  tasks: ReadonlyArray<GraphTask>,
  fold: Fold | null,
  top = 0
): GraphLayout => {
  const columnOf = columns(tasks);
  const count = Math.max(0, ...columnOf.values()) + (tasks.length === 0 ? 0 : 1);
  const lefts = columnLefts(count, fold?.axis === "vertical" ? fold.span : null);
  const rowsUsed = Array.from({ length: count }, () => 0);

  for (const task of tasks) {
    const column = columnOf.get(task.id) ?? 0;
    rowsUsed[column] = (rowsUsed[column] ?? 0) + 1;
  }

  const tallest = Math.max(0, ...rowsUsed);

  const tops = starts(
    tallest,
    top,
    NODE_HEIGHT,
    ROW_GAP,
    fold?.axis === "horizontal" ? fold.span : null
  );

  rowsUsed.fill(0);

  const nodes = tasks.map((task): PlacedNode => {
    const column = columnOf.get(task.id) ?? 0;
    const row = rowsUsed[column] ?? 0;
    rowsUsed[column] = row + 1;

    return {
      id: task.id,
      column,
      x: lefts[column] ?? EDGE,
      y: tops[row] ?? top,
    };
  });

  const at = new Map(nodes.map((n) => [n.id, n]));

  const edges = tasks.flatMap((task) =>
    task.deps.flatMap((dep): ReadonlyArray<Edge> => {
      const from = at.get(dep);
      const to = at.get(task.id);

      return from === undefined || to === undefined
        ? []
        : [
            {
              from: dep,
              to: task.id,
              x1: from.x + NODE_WIDTH,
              y1: from.y + NODE_HEIGHT / 2,
              x2: to.x,
              y2: to.y + NODE_HEIGHT / 2,
            },
          ];
    })
  );

  return {
    nodes,
    edges,
    width: (lefts.at(-1) ?? 0) + NODE_WIDTH + EDGE,
    height: tops.length === 0 ? top : (tops.at(-1) ?? top) + NODE_HEIGHT + ROW_GAP,
  };
};

/**
 * The handed-up claim's left edge: under its task, clear of a vertical division, inside the graph.
 * A horizontal division needs no shift sideways.
 */
export const claimLeft = (
  layout: GraphLayout,
  taskX: number,
  fold: Fold | null,
  claimWidth: number
): number => {
  const inside = Math.max(EDGE, Math.min(taskX, layout.width - claimWidth));

  return fold?.axis === "vertical"
    ? Math.max(fold.span.x + fold.span.width + EDGE, inside)
    : inside;
};
