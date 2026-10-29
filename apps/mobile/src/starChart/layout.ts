/**
 * Where each star sits (MX-W): a row per band, a column per wave, tasks sharing a band and wave
 * stacked; past the width the waves wrap onto another set of band rows. MX-X's dot rows past ~30.
 */
import type { StarBand, StarTask } from "./types.ts";

/** MX-X: the chart compresses to dots past about 30 tasks. */
export const COMPRESS_PAST = 30;

/** Paper MX-W's geometry, in points. */
export const GEOMETRY = {
  badge: 16,
  /** The first wave column's centre. */
  firstColumn: 34,
  /** Room right of the last column for its star and the selection ring. */
  trailing: 15,
  maxColumnGap: 70,
  /** Below this the waves wrap. */
  minColumnGap: 36,
  /** Between stacked stars in one band and wave. */
  stackGap: 20,
  /** A band's height with one star in each wave. */
  bandHeight: 28,
  bandGap: 16,
  /** Between two wrapped segments. */
  segmentGap: 20,
} as const;

/** MX-X's dot rows, in points: a badge, then dots wrapping 7pt apart below a 4pt inset. */
export const DOTS = { size: 8, gap: 7, inset: 4, badgeGap: 10, rowGap: 8 } as const;

/** A dot row's height when `count` dots wrap in a chart `width` points wide. */
export const dotRowHeight = (count: number, width: number): number => {
  const span = width - GEOMETRY.badge - DOTS.badgeGap;
  const perLine = Math.max(1, Math.floor((span + DOTS.gap) / (DOTS.size + DOTS.gap)));
  const lines = Math.max(1, Math.ceil(count / perLine));

  return Math.max(GEOMETRY.badge, DOTS.inset + lines * DOTS.size + (lines - 1) * DOTS.gap);
};

/** Tasks whose band isn't in `bands` sit in this band, last. */
export const STRAY_BAND: StarBand = { id: "", letter: "?", name: "other" };

export const isCompact = (tasks: ReadonlyArray<StarTask>, compact?: boolean): boolean =>
  compact ?? tasks.length > COMPRESS_PAST;

/** The bands that have tasks, in `bands` order, with the stray band last when needed. */
export const usedBands = (
  tasks: ReadonlyArray<StarTask>,
  bands: ReadonlyArray<StarBand>
): ReadonlyArray<StarBand> => {
  const known = new Set(bands.map((band) => band.id));
  const used = new Set(tasks.map((task) => (known.has(task.band) ? task.band : STRAY_BAND.id)));
  const listed = bands.filter((band) => used.has(band.id));

  return used.has(STRAY_BAND.id) ? [...listed, STRAY_BAND] : listed;
};

const bandOf = (task: StarTask, known: ReadonlySet<string>): string =>
  known.has(task.band) ? task.band : STRAY_BAND.id;

export interface PlacedStar {
  readonly task: StarTask;
  readonly x: number;
  readonly y: number;
}

export interface PlacedBadge {
  readonly band: StarBand;
  /** The badge's top-left corner. */
  readonly x: number;
  readonly y: number;
}

export interface ChartLayout {
  readonly width: number;
  readonly height: number;
  readonly stars: ReadonlyArray<PlacedStar>;
  readonly badges: ReadonlyArray<PlacedBadge>;
  /** Upstream to downstream, both in the same segment. */
  readonly edges: ReadonlyArray<readonly [PlacedStar, PlacedStar]>;
}

/** The distinct waves in order: a column each, so gaps in the numbering don't leave space. */
const wavesOf = (tasks: ReadonlyArray<StarTask>): ReadonlyArray<number> =>
  [...new Set(tasks.map((task) => task.wave))].sort((a, b) => a - b);

/** How many columns fit in `width`, and the gap between them. */
export interface Columns {
  /** Wave columns before the chart wraps. */
  readonly perSegment: number;
  readonly gap: number;
}

export const columnsFor = (width: number, waves: number): Columns => {
  const span = width - GEOMETRY.firstColumn - GEOMETRY.trailing;
  const fit = Math.max(1, Math.floor(span / GEOMETRY.minColumnGap) + 1);
  const perSegment = Math.min(Math.max(waves, 1), fit);
  const gap = perSegment > 1 ? Math.min(GEOMETRY.maxColumnGap, span / (perSegment - 1)) : 0;

  return { perSegment, gap };
};

const chunk = <A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size)
  );

const byWave = (tasks: ReadonlyArray<StarTask>): Map<number, Array<StarTask>> => {
  const cells = new Map<number, Array<StarTask>>();

  for (const task of tasks) cells.set(task.wave, [...(cells.get(task.wave) ?? []), task]);

  return cells;
};

interface Segment {
  readonly stars: ReadonlyArray<PlacedStar>;
  readonly badges: ReadonlyArray<PlacedBadge>;
  readonly height: number;
}

/** One wrap of the chart: every band that has a task in `waves`, from `top`. */
const placeSegment = (
  tasks: ReadonlyArray<StarTask>,
  bands: ReadonlyArray<StarBand>,
  waves: ReadonlyArray<number>,
  gap: number,
  top: number
): Segment => {
  const known = new Set(bands.map((band) => band.id));
  const column = new Map(waves.map((wave, i) => [wave, GEOMETRY.firstColumn + i * gap]));
  const inSegment = tasks.filter((task) => column.has(task.wave));
  const stars: Array<PlacedStar> = [];
  const badges: Array<PlacedBadge> = [];
  let y = top;

  for (const band of usedBands(inSegment, bands)) {
    const mine = inSegment.filter((task) => bandOf(task, known) === band.id);
    const cells = byWave(mine);
    const stack = Math.max(...[...cells.values()].map((cell) => cell.length));
    const height = GEOMETRY.bandHeight + (stack - 1) * GEOMETRY.stackGap;
    const centre = y + height / 2;

    badges.push({ band, x: 0, y: centre - GEOMETRY.badge / 2 });

    for (const [wave, cell] of cells) {
      cell.forEach((task, i) =>
        stars.push({
          task,
          x: column.get(wave) ?? 0,
          y: centre + (i - (cell.length - 1) / 2) * GEOMETRY.stackGap,
        })
      );
    }

    y += height + GEOMETRY.bandGap;
  }

  return { stars, badges, height: y - top - GEOMETRY.bandGap };
};

/** MX-W: every task placed for a chart `width` points wide. */
export const chartLayout = (
  tasks: ReadonlyArray<StarTask>,
  bands: ReadonlyArray<StarBand>,
  width: number,
  dependsOn: (task: StarTask) => ReadonlyArray<string> = () => []
): ChartLayout => {
  const waves = wavesOf(tasks);
  const { perSegment, gap } = columnsFor(width, waves.length);
  const stars: Array<PlacedStar> = [];
  const badges: Array<PlacedBadge> = [];
  const edges: Array<readonly [PlacedStar, PlacedStar]> = [];
  let top = 0;

  for (const segmentWaves of chunk(waves, perSegment)) {
    const segment = placeSegment(tasks, bands, segmentWaves, gap, top);
    const byId = new Map(segment.stars.map((star) => [star.task.id, star]));

    for (const star of segment.stars) {
      for (const upstream of dependsOn(star.task)) {
        const from = byId.get(upstream);

        if (from !== undefined) edges.push([from, star]);
      }
    }

    stars.push(...segment.stars);
    badges.push(...segment.badges);
    top += segment.height + GEOMETRY.segmentGap;
  }

  return { width, height: Math.max(0, top - GEOMETRY.segmentGap), stars, badges, edges };
};

export interface DotRow {
  readonly band: StarBand;
  /** In wave order; tasks of one wave keep their given order. */
  readonly tasks: ReadonlyArray<StarTask>;
}

/** MX-X: a row of dots per band, wrapping inside the row. */
export const dotRows = (
  tasks: ReadonlyArray<StarTask>,
  bands: ReadonlyArray<StarBand>
): ReadonlyArray<DotRow> => {
  const known = new Set(bands.map((band) => band.id));

  return usedBands(tasks, bands).map((band) => ({
    band,
    tasks: tasks.filter((task) => bandOf(task, known) === band.id).sort((a, b) => a.wave - b.wave),
  }));
};
