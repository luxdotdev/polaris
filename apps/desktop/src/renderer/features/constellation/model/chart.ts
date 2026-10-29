/**
 * The star chart's layout (DESIGN.md, Constellation glance; Paper X-H Variant 1): a column per
 * dependency wave, a band per top-level parent, the Lead at the origin, gates where lines meet.
 * Pure over the graph, so any shape lays out the same way every time.
 */
import type { TaskId } from "@polaris/protocol";
import { childrenOf, effectiveDeps, isContainer } from "./tree.ts";

export interface ChartTask {
  readonly id: TaskId;
  readonly title: string;
  readonly kind: "task" | "gate";
  readonly deps: ReadonlyArray<TaskId>;
  readonly parent?: TaskId | null;
  readonly group?: string | null;
  readonly canceled: boolean;
}

export interface ChartBand {
  readonly key: string;
  /** The parent's id as a letter badge; null for a group or the loose band. */
  readonly badge: string | null;
  /** The parent's title or the group's name; null for loose Tasks. */
  readonly name: string | null;
  readonly y: number;
  readonly height: number;
}

export interface ChartStar {
  readonly id: string;
  readonly title: string;
  readonly gate: boolean;
  /** One-based. */
  readonly wave: number;
  /** Null for a gate that floats where its inputs converge. */
  readonly band: string | null;
  readonly x: number;
  readonly y: number;
}

/** A dependency on a parent: one line from its band's edge nearest the dependent. */
export interface ChartBundle {
  readonly name: string;
  /** Every leaf inside the parent: the line is done when they all are. */
  readonly leaves: ReadonlyArray<string>;
  readonly x: number;
  readonly y: number;
}

export interface ChartEdge {
  /** A Task id (a parent's for a bundle), or null for the Lead. */
  readonly from: string | null;
  readonly to: string;
  readonly bundle: ChartBundle | null;
}

export interface StarChart {
  readonly width: number;
  readonly height: number;
  readonly waves: number;
  /** The gap between columns: how much room a label has. */
  readonly step: number;
  readonly lead: { readonly x: number; readonly y: number };
  readonly bands: ReadonlyArray<ChartBand>;
  readonly stars: ReadonlyArray<ChartStar>;
  readonly edges: ReadonlyArray<ChartEdge>;
}

/** Geometry in px; the hero's well is 624px wide in a 640px card (Paper X-H). */
export const CHART = {
  width: 624,
  /** The kicker line above the bands. */
  top: 36,
  /** Under the last band: the legend line. */
  bottom: 34,
  leadX: 40,
  firstX: 148,
  lastX: 568,
  /** Star rows inside a band. */
  row: 44,
  /** From a band's top to its first star: the band's label sits above. */
  inset: 30,
  /** Under a band's last star: its label. */
  tail: 34,
} as const;

const leavesOf = (tasks: ReadonlyArray<ChartTask>) => {
  const live = tasks.filter((t) => !t.canceled);
  const children = childrenOf(live);

  return { live, children, leaves: live.filter((t) => !isContainer(children.get(t.id))) };
};

/** A container's leaves that no other leaf inside it waits on: where its work ends. */
/** A parent's leaves, and those nothing else inside it waits on. */
interface Parts {
  readonly inside: ReadonlyArray<string>;
  readonly sinks: ReadonlyArray<string>;
}

const sinksOf = (
  id: string,
  children: ReadonlyMap<string, ReadonlyArray<ChartTask>>,
  depsOf: (t: ChartTask) => ReadonlyArray<string>
): Parts => {
  const inside: Array<ChartTask> = [];

  const visit = (at: string, seen: Set<string>) => {
    for (const c of children.get(at) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);

      if (isContainer(children.get(c.id))) visit(c.id, seen);
      else inside.push(c);
    }
  };

  visit(id, new Set([id]));
  const ids = new Set<string>(inside.map((t) => t.id));
  const waited = new Set(inside.flatMap((t) => depsOf(t).filter((d) => ids.has(d))));

  return {
    inside: inside.map((t) => t.id),
    sinks: inside.flatMap((t) => (waited.has(t.id) ? [] : [t.id])),
  };
};

/** A leaf's dependencies as drawn: a leaf on its own line, a parent as one bundled line. */
export interface Drawn {
  readonly leaves: ReadonlyArray<string>;
  readonly parents: ReadonlyArray<string>;
}

/** Each leaf's upstream leaves: its own and its ancestors' deps, a parent standing for its sinks. */
const upstreamOf = (tasks: ReadonlyArray<ChartTask>) => {
  const { live, children, leaves } = leavesOf(tasks);
  const byId = new Map<string, ChartTask>(live.map((t) => [t.id, t]));
  const leafIds = new Set<string>(leaves.map((t) => t.id));
  const own = (t: ChartTask) => effectiveDeps(byId, t);
  const parts = new Map<string, Parts>();

  const partsOf = (dep: string) => {
    const known = parts.get(dep);

    if (known !== undefined) return known;
    const found = sinksOf(dep, children, own);

    const kept = {
      inside: found.inside.filter((s) => leafIds.has(s)),
      sinks: found.sinks.filter((s) => leafIds.has(s)),
    };

    parts.set(dep, kept);

    return kept;
  };

  const expand = (dep: string): ReadonlyArray<string> => {
    if (leafIds.has(dep)) return [dep];

    return byId.has(dep) ? partsOf(dep).sinks : [];
  };

  const upstream = new Map<string, ReadonlyArray<string>>(
    leaves.map((t) => [t.id, [...new Set(own(t).flatMap(expand))].filter((d) => d !== t.id)])
  );

  const drawnOf = (t: ChartTask): Drawn => {
    const deps = [...new Set(own(t))].filter((d) => d !== t.id);

    const parents = deps.filter(
      (d) =>
        !leafIds.has(d) &&
        byId.has(d) &&
        partsOf(d).sinks.length > 0 &&
        !partsOf(d).inside.includes(t.id)
    );

    const covered = new Set(parents.flatMap((d) => partsOf(d).inside));

    return { leaves: deps.filter((d) => leafIds.has(d) && !covered.has(d)), parents };
  };

  const drawn = new Map<string, Drawn>(leaves.map((t) => [t.id, drawnOf(t)]));

  return { byId, leaves, upstream, drawn, inside: (id: string) => partsOf(id) };
};

/** Longest path from a root, one-based; an edge that closes a cycle counts for nothing. */
const wavesOf = (
  leaves: ReadonlyArray<ChartTask>,
  upstream: ReadonlyMap<string, ReadonlyArray<string>>
) => {
  const wave = new Map<string, number>();
  const open = new Set<string>();

  const depth = (id: string): number => {
    const known = wave.get(id);

    if (known !== undefined) return known;

    if (open.has(id)) return 0;
    open.add(id);
    const w = 1 + Math.max(0, ...(upstream.get(id) ?? []).map(depth));

    open.delete(id);
    wave.set(id, w);

    return w;
  };

  for (const t of leaves) depth(t.id);

  return wave;
};

/** The band a leaf sits in: its outermost parent's, else its group's, else the loose band. */
const bandOf = (byId: ReadonlyMap<string, ChartTask>, task: ChartTask) => {
  let root: ChartTask | null = null;
  let at = task.parent ?? null;
  const seen = new Set<string>([task.id]);

  while (at !== null && !seen.has(at)) {
    seen.add(at);
    const node = byId.get(at);

    if (node === undefined) break;
    root = node;
    at = node.parent ?? null;
  }

  if (root !== null) return { key: `parent:${root.id}`, badge: root.id, name: root.title };
  const group = task.group ?? null;

  return group === null || group === ""
    ? { key: "loose", badge: null, name: null }
    : { key: `group:${group}`, badge: null, name: group };
};

/** A gate outside every parent floats where its inputs meet; one inside a parent stays in it. */
const floats = (task: ChartTask) => task.kind === "gate" && (task.parent ?? null) === null;

const mean = (values: ReadonlyArray<number>, fallback: number) =>
  values.length === 0 ? fallback : values.reduce((a, b) => a + b, 0) / values.length;

interface Placed {
  readonly task: ChartTask;
  readonly wave: number;
  readonly band: string;
}

/**
 * Rows inside one band: each column's stars ordered by where their upstream sits (the
 * barycentre, two sweeps), declaration order breaking ties.
 */
const rowsIn = (
  members: ReadonlyArray<Placed>,
  upstream: ReadonlyMap<string, ReadonlyArray<string>>,
  order: ReadonlyMap<string, number>
) => {
  const row = new Map<string, number>();
  const columns = new Map<number, Array<Placed>>();

  for (const m of members) columns.set(m.wave, [...(columns.get(m.wave) ?? []), m]);
  const waves = [...columns.keys()].sort((a, b) => a - b);

  const place = (column: ReadonlyArray<Placed>, weight: (p: Placed) => number) =>
    column
      .toSorted(
        (a, b) => weight(a) - weight(b) || (order.get(a.task.id) ?? 0) - (order.get(b.task.id) ?? 0)
      )
      .forEach((p, n) => row.set(p.task.id, n));

  for (const w of waves) place(columns.get(w) ?? [], (p) => order.get(p.task.id) ?? 0);

  for (let sweep = 0; sweep < 2; sweep++)
    for (const w of waves) {
      const column = columns.get(w) ?? [];

      place(column, (p) =>
        mean(
          (upstream.get(p.task.id) ?? []).flatMap((u) => {
            const r = row.get(u);

            return r === undefined ? [] : [r];
          }),
          row.get(p.task.id) ?? 0
        )
      );
    }

  const rows = Math.max(1, ...[...columns.values()].map((c) => c.length));

  return { row, rows };
};

const columnX = (wave: number, waves: number) => {
  if (waves <= 1) return CHART.firstX;

  return CHART.firstX + ((wave - 1) * (CHART.lastX - CHART.firstX)) / (waves - 1);
};

/** Bands top to bottom in the order their first Task was declared. */
const layBands = (
  placed: ReadonlyArray<Placed>,
  byId: ReadonlyMap<string, ChartTask>,
  upstream: ReadonlyMap<string, ReadonlyArray<string>>,
  order: ReadonlyMap<string, number>
) => {
  const keys = [...new Set(placed.map((p) => p.band))];
  const bands: Array<ChartBand> = [];
  const y = new Map<string, number>();
  let top = CHART.top;

  for (const key of keys) {
    const members = placed.filter((p) => p.band === key);
    const first = members[0];

    if (first === undefined) continue;
    const { row, rows } = rowsIn(members, upstream, order);
    const height = CHART.inset + (rows - 1) * CHART.row + CHART.tail;
    const head = bandOf(byId, first.task);

    bands.push({ key, badge: head.badge, name: head.name, y: top, height });

    for (const m of members)
      y.set(m.task.id, top + CHART.inset + (row.get(m.task.id) ?? 0) * CHART.row);
    top += height;
  }

  return { bands, y, bottom: top };
};

/** A floating gate sits at its inputs' mean height, nudged down off any star in its column. */
const floatY = (
  gate: Placed,
  upstream: ReadonlyMap<string, ReadonlyArray<string>>,
  y: Map<string, number>,
  taken: ReadonlyArray<{ readonly wave: number; readonly y: number }>,
  middle: number
) => {
  let at = Math.round(
    mean(
      (upstream.get(gate.task.id) ?? []).flatMap((u) => {
        const v = y.get(u);

        return v === undefined ? [] : [v];
      }),
      middle
    )
  );

  while (taken.some((t) => t.wave === gate.wave && Math.abs(t.y - at) < CHART.row)) at += CHART.row;

  return at;
};

type Upstream = ReturnType<typeof upstreamOf>;

const starsAt = (ids: ReadonlyArray<string>, at: ReadonlyMap<string, ChartStar>) =>
  ids.flatMap((id) => {
    const s = at.get(id);

    return s === undefined ? [] : [s];
  });

/** Where a parent's line starts: its last sink's column, on its band's edge nearest `to`. */
const bundleFrom = (
  parent: ChartTask,
  parts: Parts,
  at: ReadonlyMap<string, ChartStar>,
  bands: ReadonlyArray<ChartBand>,
  to: ChartStar
): ChartBundle | null => {
  const sinks = starsAt(parts.sinks, at);
  const inside = starsAt(parts.inside, at);

  if (sinks.length === 0) return null;
  const band = bands.find((b) => b.key === `parent:${parent.id}`);
  const top = band?.y ?? Math.min(...inside.map((s) => s.y)) - CHART.row / 2;

  const bottom =
    band === undefined ? Math.max(...inside.map((s) => s.y)) + CHART.row / 2 : band.y + band.height;

  return {
    name: parent.title,
    leaves: parts.inside,
    x: Math.max(...sinks.map((s) => s.x)),
    y: Math.round(Math.min(bottom, Math.max(top, to.y))),
  };
};

/** The Lead to the first wave, then each leaf's drawn dependencies. */
const edgesOf = (
  up: Upstream,
  stars: ReadonlyArray<ChartStar>,
  bands: ReadonlyArray<ChartBand>
): ReadonlyArray<ChartEdge> => {
  const at = new Map(stars.map((s) => [s.id, s]));

  const into = (to: ChartStar): ReadonlyArray<ChartEdge> => {
    const drawn = up.drawn.get(to.id);

    if (drawn === undefined) return [];

    return [
      ...drawn.leaves.map((from) => ({ from, to: to.id, bundle: null })),
      ...drawn.parents.flatMap((from) => {
        const parent = up.byId.get(from);

        const bundle =
          parent === undefined ? null : bundleFrom(parent, up.inside(from), at, bands, to);

        return bundle === null ? [] : [{ from, to: to.id, bundle }];
      }),
    ];
  };

  return [
    ...stars.flatMap((s) => (s.wave === 1 ? [{ from: null, to: s.id, bundle: null }] : [])),
    ...stars.flatMap(into),
  ];
};

export const starChart = (tasks: ReadonlyArray<ChartTask>): StarChart => {
  const up = upstreamOf(tasks);
  const { byId, leaves, upstream } = up;
  const wave = wavesOf(leaves, upstream);
  const waves = Math.max(1, ...wave.values());
  const order = new Map(tasks.map((t, n) => [t.id, n]));

  const all: ReadonlyArray<Placed> = leaves.map((task) => ({
    task,
    wave: wave.get(task.id) ?? 1,
    band: floats(task) ? "" : bandOf(byId, task).key,
  }));

  const { bands, y, bottom } = layBands(
    all.filter((p) => p.band !== ""),
    byId,
    upstream,
    order
  );

  const middle = bands.length === 0 ? CHART.top + CHART.inset : (CHART.top + bottom) / 2;

  const taken = all.flatMap((p) => {
    const at = y.get(p.task.id);

    return at === undefined ? [] : [{ wave: p.wave, y: at }];
  });

  for (const gate of all
    .filter((p) => p.band === "")
    .toSorted(
      (a, b) => a.wave - b.wave || (order.get(a.task.id) ?? 0) - (order.get(b.task.id) ?? 0)
    )) {
    const at = floatY(gate, upstream, y, taken, middle);

    y.set(gate.task.id, at);
    taken.push({ wave: gate.wave, y: at });
  }

  const stars: ReadonlyArray<ChartStar> = all.map((p) => ({
    id: p.task.id,
    title: p.task.title,
    gate: p.task.kind === "gate",
    wave: p.wave,
    band: p.band === "" ? null : p.band,
    x: Math.round(columnX(p.wave, waves)),
    y: y.get(p.task.id) ?? middle,
  }));

  const lowest = Math.max(bottom, ...stars.map((s) => s.y + CHART.tail));

  return {
    width: CHART.width,
    height: lowest + CHART.bottom,
    waves,
    step: waves <= 1 ? CHART.lastX - CHART.firstX : (CHART.lastX - CHART.firstX) / (waves - 1),
    lead: { x: CHART.leadX, y: Math.round(middle) },
    bands,
    stars,
    edges: edgesOf(up, stars, bands),
  };
};
